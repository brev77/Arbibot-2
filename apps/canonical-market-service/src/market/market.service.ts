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

@Injectable()
export class MarketService {
  constructor(
    @InjectRepository(VenueRefEntity)
    private readonly venueRepo: Repository<VenueRefEntity>,
    @InjectRepository(CanonicalInstrumentEntity)
    private readonly instrumentRepo: Repository<CanonicalInstrumentEntity>,
    @InjectRepository(CanonicalRouteEntity)
    private readonly routeRepo: Repository<CanonicalRouteEntity>,
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

    let row: CanonicalInstrumentEntity | null;
    if (hasKey) {
      row = await this.instrumentRepo.findOne({
        where: { canonicalKey: canonicalKey! },
        relations: { venueRef: true },
      });
    } else {
      const venue = await this.venueRepo.findOne({
        where: { venueCode: venueCode! },
      });
      if (venue === null) {
        throw new NotFoundException(`Unknown venue: ${venueCode}`);
      }
      row = await this.instrumentRepo.findOne({
        where: { venueRefId: venue.id, venueSymbol: venueSymbol! },
        relations: { venueRef: true },
      });
    }
    if (row === null) {
      throw new NotFoundException('Instrument not found');
    }
    return this.toInstrumentView(row);
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

    let row: CanonicalRouteEntity | null;
    if (hasKey) {
      row = await this.routeRepo.findOne({ where: { routeKey: routeKey! } });
    } else {
      const rows = await this.routeRepo.find({
        where: {
          sourceInstrumentId: sid!,
          targetInstrumentId: tid!,
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
    return this.toRouteView(row);
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
