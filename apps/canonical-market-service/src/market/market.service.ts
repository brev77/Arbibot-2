import { createHash } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  CanonicalInstrumentEntity,
  CanonicalRouteEntity,
  VenueRefEntity,
} from '@arbibot/persistence';
import { Repository } from 'typeorm';

import { RedisConnection } from '../redis/redis-connection';
import type { ResolveInstrumentDto } from './dto/resolve-instrument.dto';
import type { ResolveRouteDto } from './dto/resolve-route.dto';

export type ResolvedInstrumentView = {
  readonly id: string;
  readonly venueCode: string;
  readonly venueSymbol: string;
  readonly canonicalKey: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly attributes: Record<string, unknown>;
  readonly entityVersion: number;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
};

export type ResolvedRouteView = {
  readonly id: string;
  readonly routeKey: string;
  readonly sourceInstrumentId: string;
  readonly targetInstrumentId: string;
  readonly hops: unknown[];
  readonly entityVersion: number;
  readonly createdAtIso: string;
  readonly updatedAtIso: string;
};

const RESOLVE_CACHE_TTL_SEC = 90;

@Injectable()
export class MarketService {
  constructor(
    @InjectRepository(VenueRefEntity)
    private readonly venueRepo: Repository<VenueRefEntity>,
    @InjectRepository(CanonicalInstrumentEntity)
    private readonly instrumentRepo: Repository<CanonicalInstrumentEntity>,
    @InjectRepository(CanonicalRouteEntity)
    private readonly routeRepo: Repository<CanonicalRouteEntity>,
    private readonly redisConnection: RedisConnection,
  ) {}

  async resolveInstrument(dto: ResolveInstrumentDto): Promise<ResolvedInstrumentView> {
    const canonicalKey = dto.canonicalKey?.trim();
    const venueCode = dto.venueCode?.trim();
    const venueSymbol = dto.venueSymbol?.trim();
    const hasKey = canonicalKey !== undefined && canonicalKey.length > 0;
    const hasPair =
      venueCode !== undefined &&
      venueCode.length > 0 &&
      venueSymbol !== undefined &&
      venueSymbol.length > 0;
    if ((hasKey && hasPair) || (!hasKey && !hasPair)) {
      throw new BadRequestException(
        'Provide either canonicalKey or both venueCode and venueSymbol',
      );
    }
    if (hasKey && (venueCode || venueSymbol)) {
      throw new BadRequestException(
        'Do not mix canonicalKey with venueCode/venueSymbol',
      );
    }

    const cacheKey = this.buildInstrumentCacheKey(
      hasKey,
      canonicalKey,
      venueCode,
      venueSymbol,
    );
    const cached = await this.tryGetInstrumentCache(cacheKey);
    if (cached !== null) {
      return cached;
    }

    let row: CanonicalInstrumentEntity | null;
    if (hasKey) {
      row = await this.instrumentRepo.findOne({
        where: { canonicalKey },
        relations: { venueRef: true },
      });
    } else {
      const venue = await this.venueRepo.findOne({
        where: { venueCode },
      });
      if (venue === null) {
        throw new NotFoundException(`Unknown venue: ${venueCode}`);
      }
      row = await this.instrumentRepo.findOne({
        where: { venueRefId: venue.id, venueSymbol },
        relations: { venueRef: true },
      });
    }
    if (row === null) {
      throw new NotFoundException('Instrument not found');
    }
    const view = this.toInstrumentView(row);
    await this.trySetInstrumentCache(cacheKey, view);
    return view;
  }

  async resolveRoute(dto: ResolveRouteDto): Promise<ResolvedRouteView> {
    const routeKey = dto.routeKey?.trim();
    const sid = dto.sourceInstrumentId;
    const tid = dto.targetInstrumentId;
    const hasKey = routeKey !== undefined && routeKey.length > 0;
    const hasPair = sid !== undefined && tid !== undefined;
    if ((hasKey && hasPair) || (!hasKey && !hasPair)) {
      throw new BadRequestException(
        'Provide either routeKey or both sourceInstrumentId and targetInstrumentId',
      );
    }
    if (hasKey && (sid || tid)) {
      throw new BadRequestException(
        'Do not mix routeKey with sourceInstrumentId/targetInstrumentId',
      );
    }

    const cacheKey = this.buildRouteCacheKey(hasKey, routeKey, sid, tid);
    const cached = await this.tryGetRouteCache(cacheKey);
    if (cached !== null) {
      return cached;
    }

    let row: CanonicalRouteEntity | null;
    if (hasKey) {
      row = await this.routeRepo.findOne({ where: { routeKey } });
    } else {
      const rows = await this.routeRepo.find({
        where: {
          sourceInstrumentId: sid,
          targetInstrumentId: tid,
        },
        take: 2,
      });
      if (rows.length > 1) {
        throw new ConflictException(
          'Ambiguous route resolution for instrument pair; use routeKey',
        );
      }
      row = rows[0] ?? null;
    }
    if (row === null) {
      throw new NotFoundException('Route not found');
    }
    const view = this.toRouteView(row);
    await this.trySetRouteCache(cacheKey, view);
    return view;
  }

  private buildInstrumentCacheKey(
    hasKey: boolean,
    canonicalKey: string | undefined,
    venueCode: string | undefined,
    venueSymbol: string | undefined,
  ): string {
    const payload = hasKey
      ? { v: 1, t: 'ck', canonicalKey: canonicalKey! }
      : { v: 1, t: 'vs', venueCode: venueCode!, venueSymbol: venueSymbol! };
    const h = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return `arb:canonical:ri:v1:${h}`;
  }

  private buildRouteCacheKey(
    hasKey: boolean,
    routeKey: string | undefined,
    sid: string | undefined,
    tid: string | undefined,
  ): string {
    const payload = hasKey
      ? { v: 1, t: 'rk', routeKey: routeKey! }
      : { v: 1, t: 'pair', sourceInstrumentId: sid!, targetInstrumentId: tid! };
    const h = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return `arb:canonical:rr:v1:${h}`;
  }

  private async tryGetInstrumentCache(
    key: string,
  ): Promise<ResolvedInstrumentView | null> {
    const redis = this.redisConnection.client;
    if (redis === null) {
      return null;
    }
    try {
      const raw = await redis.get(key);
      if (raw === null || raw.length === 0) {
        return null;
      }
      return this.parseInstrumentCache(raw);
    } catch {
      return null;
    }
  }

  private async trySetInstrumentCache(
    key: string,
    view: ResolvedInstrumentView,
  ): Promise<void> {
    const redis = this.redisConnection.client;
    if (redis === null) {
      return;
    }
    try {
      await redis.setEx(key, RESOLVE_CACHE_TTL_SEC, JSON.stringify(view));
    } catch {
      /* ignore cache write failures */
    }
  }

  private parseInstrumentCache(raw: string): ResolvedInstrumentView | null {
    try {
      const v = JSON.parse(raw) as unknown;
      if (typeof v !== 'object' || v === null) {
        return null;
      }
      const o = v as Record<string, unknown>;
      if (
        typeof o.id !== 'string' ||
        typeof o.venueCode !== 'string' ||
        typeof o.venueSymbol !== 'string' ||
        typeof o.canonicalKey !== 'string' ||
        typeof o.baseAsset !== 'string' ||
        typeof o.quoteAsset !== 'string' ||
        typeof o.entityVersion !== 'number' ||
        typeof o.createdAtIso !== 'string' ||
        typeof o.updatedAtIso !== 'string' ||
        typeof o.attributes !== 'object' ||
        o.attributes === null ||
        Array.isArray(o.attributes)
      ) {
        return null;
      }
      return {
        id: o.id,
        venueCode: o.venueCode,
        venueSymbol: o.venueSymbol,
        canonicalKey: o.canonicalKey,
        baseAsset: o.baseAsset,
        quoteAsset: o.quoteAsset,
        attributes: o.attributes as Record<string, unknown>,
        entityVersion: o.entityVersion,
        createdAtIso: o.createdAtIso,
        updatedAtIso: o.updatedAtIso,
      };
    } catch {
      return null;
    }
  }

  private async tryGetRouteCache(key: string): Promise<ResolvedRouteView | null> {
    const redis = this.redisConnection.client;
    if (redis === null) {
      return null;
    }
    try {
      const raw = await redis.get(key);
      if (raw === null || raw.length === 0) {
        return null;
      }
      return this.parseRouteCache(raw);
    } catch {
      return null;
    }
  }

  private async trySetRouteCache(key: string, view: ResolvedRouteView): Promise<void> {
    const redis = this.redisConnection.client;
    if (redis === null) {
      return;
    }
    try {
      await redis.setEx(key, RESOLVE_CACHE_TTL_SEC, JSON.stringify(view));
    } catch {
      /* ignore cache write failures */
    }
  }

  private parseRouteCache(raw: string): ResolvedRouteView | null {
    try {
      const v = JSON.parse(raw) as unknown;
      if (typeof v !== 'object' || v === null) {
        return null;
      }
      const o = v as Record<string, unknown>;
      if (
        typeof o.id !== 'string' ||
        typeof o.routeKey !== 'string' ||
        typeof o.sourceInstrumentId !== 'string' ||
        typeof o.targetInstrumentId !== 'string' ||
        !Array.isArray(o.hops) ||
        typeof o.entityVersion !== 'number' ||
        typeof o.createdAtIso !== 'string' ||
        typeof o.updatedAtIso !== 'string'
      ) {
        return null;
      }
      return {
        id: o.id,
        routeKey: o.routeKey,
        sourceInstrumentId: o.sourceInstrumentId,
        targetInstrumentId: o.targetInstrumentId,
        hops: o.hops,
        entityVersion: o.entityVersion,
        createdAtIso: o.createdAtIso,
        updatedAtIso: o.updatedAtIso,
      };
    } catch {
      return null;
    }
  }

  private toInstrumentView(row: CanonicalInstrumentEntity): ResolvedInstrumentView {
    const venueCode = row.venueRef?.venueCode ?? '';
    return {
      id: row.id,
      venueCode,
      venueSymbol: row.venueSymbol,
      canonicalKey: row.canonicalKey,
      baseAsset: row.baseAsset,
      quoteAsset: row.quoteAsset,
      attributes: row.attributes,
      entityVersion: row.entityVersion,
      createdAtIso: row.createdAt.toISOString(),
      updatedAtIso: row.updatedAt.toISOString(),
    };
  }

  private toRouteView(row: CanonicalRouteEntity): ResolvedRouteView {
    return {
      id: row.id,
      routeKey: row.routeKey,
      sourceInstrumentId: row.sourceInstrumentId,
      targetInstrumentId: row.targetInstrumentId,
      hops: row.hops,
      entityVersion: row.entityVersion,
      createdAtIso: row.createdAt.toISOString(),
      updatedAtIso: row.updatedAt.toISOString(),
    };
  }
}
