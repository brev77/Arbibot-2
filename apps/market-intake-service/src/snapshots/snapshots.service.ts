import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditClientService } from '@arbibot/nest-platform';
import { createHash, randomUUID } from 'node:crypto';

import {
  EVENT_NAMES,
  SERVICE_IDS,
  type SnapshotUpdatedPayloadV2,
} from '@arbibot/contracts';
import { getCorrelationId } from '@arbibot/nest-platform';
import {
  MarketSnapshotEntity,
  MarketSnapshotIngestIdempotencyEntity,
  OutboxEventEntity,
} from '@arbibot/persistence';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';

import type { IngestMarketSnapshotDto } from './dto/ingest-market-snapshot.dto';
import { IntakeThrottleService } from '../policy/intake-throttle.service';

/** Outbox / envelope payload schema for SnapshotUpdated (must match JSON Schema + consumers). */
const SNAPSHOT_EVENT_SCHEMA_VERSION = 2;
const INGEST_UNIQUE_RETRY_MAX = 5;

export type IngestMarketSnapshotResult = {
  snapshotId: string;
  outboxMessageId: string | null;
  entityVersion: number;
  idempotentReplay: boolean;
  unchanged: boolean;
  /** When true, no DB write occurred (backpressure / sampling). */
  throttled?: boolean;
  throttleReason?: string;
};

function optDecimal(n: number | undefined): string | null {
  if (n === undefined) {
    return null;
  }
  return String(n);
}

/**
 * Idempotency fingerprint: fields that define the desired snapshot state.
 * Excludes correlationId and idempotencyKey (transport / dedupe metadata only).
 */
function ingestRequestFingerprint(dto: IngestMarketSnapshotDto): string {
  const normalized = {
    venueCode: dto.venueCode,
    venueSymbol: dto.venueSymbol,
    observedAt: dto.observedAt,
    canonicalInstrumentId: dto.canonicalInstrumentId ?? null,
    bid: dto.bid ?? null,
    ask: dto.ask ?? null,
    last: dto.last ?? null,
    staleAfterSeconds: dto.staleAfterSeconds ?? null,
    payload: dto.payload ?? null,
  };
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
}

function isPgUniqueViolation(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) {
    return false;
  }
  const driverError = (
    err as QueryFailedError & { driverError?: { code?: string } }
  ).driverError;
  return driverError?.code === '23505';
}

async function advisoryLockIngestKey(
  em: EntityManager,
  idempotencyKey: string,
): Promise<void> {
  const h = createHash('sha256').update(idempotencyKey).digest();
  const k1 = h.readInt32BE(0);
  const k2 = h.readInt32BE(4);
  await em.query('SELECT pg_advisory_xact_lock($1, $2)', [k1, k2]);
}

@Injectable()
export class SnapshotsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly throttle: IntakeThrottleService,
    private readonly audit: AuditClientService,
  ) {}

  async ingest(dto: IngestMarketSnapshotDto): Promise<IngestMarketSnapshotResult> {
    const td = await this.throttle.evaluate(dto);
    if (!td.allow) {
      if (td.requireAudit) {
        this.audit.record({
          actor: 'market-intake-service',
          action: 'INTAKE_SNAPSHOT_THROTTLED',
          resourceType: 'MarketSnapshot',
          resourceId: `${dto.venueCode}:${dto.venueSymbol}`,
          payload: {
            reason: td.reason,
            routingTier: td.routingTier,
            instrumentKey: dto.instrumentKey ?? null,
            routeKey: dto.routeKey ?? null,
          },
        });
      }
      return {
        snapshotId: '',
        outboxMessageId: null,
        entityVersion: 0,
        idempotentReplay: false,
        unchanged: false,
        throttled: true,
        throttleReason: td.reason,
      };
    }

    const observedAt = new Date(dto.observedAt);
    if (Number.isNaN(observedAt.getTime())) {
      throw new BadRequestException('Invalid observedAt');
    }
    const correlationId =
      dto.correlationId ?? getCorrelationId() ?? randomUUID();
    const receivedAt = new Date();
    const requestHash = ingestRequestFingerprint(dto);

    for (let attempt = 0; attempt < INGEST_UNIQUE_RETRY_MAX; attempt++) {
      try {
        return await this.dataSource.transaction(async (em) => {
          if (dto.idempotencyKey !== undefined) {
            await advisoryLockIngestKey(em, dto.idempotencyKey);
            const existingIdem = await em.findOne(
              MarketSnapshotIngestIdempotencyEntity,
              {
                where: { idempotencyKey: dto.idempotencyKey },
                lock: { mode: 'pessimistic_write' },
              },
            );
            if (existingIdem !== null) {
              if (existingIdem.requestHash !== requestHash) {
                throw new ConflictException(
                  `Market snapshot idempotency key ${dto.idempotencyKey} conflicts with request payload`,
                );
              }
              return {
                snapshotId: existingIdem.snapshotId,
                outboxMessageId: existingIdem.outboxMessageId,
                entityVersion: existingIdem.entityVersion,
                idempotentReplay: true,
                unchanged: existingIdem.unchanged,
              };
            }
          }

          const snapRepo = em.getRepository(MarketSnapshotEntity);
          let row = await snapRepo.findOne({
            where: { venueCode: dto.venueCode, venueSymbol: dto.venueSymbol },
            lock: { mode: 'pessimistic_write' },
          });

          if (row === null) {
            const created = em.create(MarketSnapshotEntity, {
              venueCode: dto.venueCode,
              venueSymbol: dto.venueSymbol,
              canonicalInstrumentId: dto.canonicalInstrumentId ?? null,
              bid: optDecimal(dto.bid),
              ask: optDecimal(dto.ask),
              last: optDecimal(dto.last),
              payload: dto.payload ?? {},
              observedAt,
              receivedAt,
              staleAfterSeconds: dto.staleAfterSeconds ?? null,
              entityVersion: 1,
            });
            await em.save(MarketSnapshotEntity, created);
            row = created;
          } else {
            if (observedAt.getTime() < row.observedAt.getTime()) {
              const unchanged = true;
              const out: IngestMarketSnapshotResult = {
                snapshotId: row.id,
                outboxMessageId: null,
                entityVersion: row.entityVersion,
                idempotentReplay: false,
                unchanged,
              };
              if (dto.idempotencyKey !== undefined) {
                await em.save(
                  MarketSnapshotIngestIdempotencyEntity,
                  em.create(MarketSnapshotIngestIdempotencyEntity, {
                    idempotencyKey: dto.idempotencyKey,
                    requestHash,
                    snapshotId: row.id,
                    outboxMessageId: null,
                    entityVersion: row.entityVersion,
                    unchanged,
                  }),
                );
              }
              return out;
            }

            const nextCanonical =
              dto.canonicalInstrumentId ?? row.canonicalInstrumentId;
            const nextBid = optDecimal(dto.bid) ?? row.bid;
            const nextAsk = optDecimal(dto.ask) ?? row.ask;
            const nextLast = optDecimal(dto.last) ?? row.last;
            const nextPayload = dto.payload ?? row.payload;
            const nextStale =
              dto.staleAfterSeconds !== undefined
                ? dto.staleAfterSeconds
                : row.staleAfterSeconds;
            const nextObserved = observedAt;

            const contentSame =
              nextCanonical === row.canonicalInstrumentId &&
              nextBid === row.bid &&
              nextAsk === row.ask &&
              nextLast === row.last &&
              JSON.stringify(nextPayload) === JSON.stringify(row.payload) &&
              nextStale === row.staleAfterSeconds &&
              nextObserved.getTime() === row.observedAt.getTime();

            if (contentSame) {
              const unchanged = true;
              const out: IngestMarketSnapshotResult = {
                snapshotId: row.id,
                outboxMessageId: null,
                entityVersion: row.entityVersion,
                idempotentReplay: false,
                unchanged,
              };
              if (dto.idempotencyKey !== undefined) {
                await em.save(
                  MarketSnapshotIngestIdempotencyEntity,
                  em.create(MarketSnapshotIngestIdempotencyEntity, {
                    idempotencyKey: dto.idempotencyKey,
                    requestHash,
                    snapshotId: row.id,
                    outboxMessageId: null,
                    entityVersion: row.entityVersion,
                    unchanged,
                  }),
                );
              }
              return out;
            }

            row.canonicalInstrumentId = nextCanonical;
            row.bid = nextBid;
            row.ask = nextAsk;
            row.last = nextLast;
            row.payload = nextPayload;
            row.observedAt = nextObserved;
            row.receivedAt = receivedAt;
            row.staleAfterSeconds = nextStale;
            row.entityVersion += 1;
            await em.save(MarketSnapshotEntity, row);
          }

          const messageId = randomUUID();
          const eventTs = receivedAt.toISOString();
          const payload: SnapshotUpdatedPayloadV2 = {
            snapshotId: row.id,
            venueCode: row.venueCode,
            venueSymbol: row.venueSymbol,
            observedAt: row.observedAt.toISOString(),
            receivedAt: row.receivedAt.toISOString(),
            entityVersion: row.entityVersion,
            staleAfterSeconds: row.staleAfterSeconds ?? null,
            payload: row.payload,
            ...(row.canonicalInstrumentId !== null
              ? { canonicalInstrumentId: row.canonicalInstrumentId }
              : {}),
            ...(row.bid !== null ? { bid: Number(row.bid) } : {}),
            ...(row.ask !== null ? { ask: Number(row.ask) } : {}),
            ...(row.last !== null ? { last: Number(row.last) } : {}),
          };
          const envelope = {
            messageId,
            correlationId,
            entityType: 'MarketSnapshot',
            entityId: row.id,
            version: SNAPSHOT_EVENT_SCHEMA_VERSION,
            sourceModule: SERVICE_IDS.marketIntakeService,
            eventTs,
            eventName: EVENT_NAMES.snapshotUpdated,
            payload,
          };
          const outbox = em.create(OutboxEventEntity, {
            messageId,
            eventType: EVENT_NAMES.snapshotUpdated,
            entityType: 'MarketSnapshot',
            entityId: row.id,
            schemaVersion: SNAPSHOT_EVENT_SCHEMA_VERSION,
            payload: payload as unknown as Record<string, unknown>,
            envelope: envelope as unknown as Record<string, unknown>,
            processedAt: null,
          });
          await em.save(OutboxEventEntity, outbox);

          if (dto.idempotencyKey !== undefined) {
            await em.save(
              MarketSnapshotIngestIdempotencyEntity,
              em.create(MarketSnapshotIngestIdempotencyEntity, {
                idempotencyKey: dto.idempotencyKey,
                requestHash,
                snapshotId: row.id,
                outboxMessageId: messageId,
                entityVersion: row.entityVersion,
                unchanged: false,
              }),
            );
          }

          return {
            snapshotId: row.id,
            outboxMessageId: messageId,
            entityVersion: row.entityVersion,
            idempotentReplay: false,
            unchanged: false,
          };
        });
      } catch (e) {
        if (isPgUniqueViolation(e) && attempt < INGEST_UNIQUE_RETRY_MAX - 1) {
          continue;
        }
        throw e;
      }
    }

    throw new Error('Ingest retry budget exhausted');
  }

  /**
   * Find fresh (non-stale) snapshots for the discovery pipeline.
   * A snapshot is stale when staleAfterSeconds > 0
   * and (observedAt + staleAfterSeconds * 1000) < now.
   */
  async findFresh(limit = 100): Promise<{
    items: Array<{
      id: string;
      venueCode: string;
      venueSymbol: string;
      instrumentKey: string | null;
      routeKey: string | null;
      bid: number | null;
      ask: number | null;
      observedAt: string;
      isStale: boolean;
    }>;
    total: number;
  }> {
    const repo = this.dataSource.getRepository(MarketSnapshotEntity);
    const now = Date.now();

    // Fetch recent snapshots — filter stale ones in-code because
    // staleAfterSeconds is a per-row threshold, not a static column.
    const rows = await repo.find({
      order: { observedAt: 'DESC' },
      take: Math.min(limit * 3, 1000),
    });

    const fresh = rows
      .filter((row) => {
        if (row.staleAfterSeconds === null || row.staleAfterSeconds <= 0) {
          return true;
        }
        const deadline =
          row.observedAt.getTime() + row.staleAfterSeconds * 1000;
        return now <= deadline;
      })
      .slice(0, limit);

    return {
      items: fresh.map((row) => ({
        id: row.id,
        venueCode: row.venueCode,
        venueSymbol: row.venueSymbol,
        instrumentKey:
          typeof row.payload?.instrumentKey === 'string'
            ? row.payload.instrumentKey
            : null,
        routeKey:
          typeof row.payload?.routeKey === 'string'
            ? row.payload.routeKey
            : null,
        bid: row.bid !== null ? Number(row.bid) : null,
        ask: row.ask !== null ? Number(row.ask) : null,
        observedAt: row.observedAt.toISOString(),
        isStale: false,
      })),
      total: fresh.length,
    };
  }

  async getOne(
    venueCode: string,
    venueSymbol: string,
  ): Promise<{
    snapshot: {
      id: string;
      venueCode: string;
      venueSymbol: string;
      canonicalInstrumentId: string | null;
      bid: number | null;
      ask: number | null;
      last: number | null;
      payload: Record<string, unknown>;
      observedAt: string;
      receivedAt: string;
      staleAfterSeconds: number | null;
      entityVersion: number;
    };
    freshness: {
      observedAt: string;
      receivedAt: string;
      staleAfterSeconds: number | null;
      isStale: boolean;
    };
  }> {
    const row = await this.dataSource.getRepository(MarketSnapshotEntity).findOne(
      {
        where: { venueCode, venueSymbol },
      },
    );
    if (row === null) {
      throw new NotFoundException('Snapshot not found');
    }
    const now = Date.now();
    let isStale = false;
    if (
      row.staleAfterSeconds !== null &&
      row.staleAfterSeconds !== undefined &&
      row.staleAfterSeconds > 0
    ) {
      const deadline =
        row.observedAt.getTime() + row.staleAfterSeconds * 1000;
      isStale = now > deadline;
    }
    return {
      snapshot: {
        id: row.id,
        venueCode: row.venueCode,
        venueSymbol: row.venueSymbol,
        canonicalInstrumentId: row.canonicalInstrumentId,
        bid: row.bid !== null ? Number(row.bid) : null,
        ask: row.ask !== null ? Number(row.ask) : null,
        last: row.last !== null ? Number(row.last) : null,
        payload: row.payload,
        observedAt: row.observedAt.toISOString(),
        receivedAt: row.receivedAt.toISOString(),
        staleAfterSeconds: row.staleAfterSeconds,
        entityVersion: row.entityVersion,
      },
      freshness: {
        observedAt: row.observedAt.toISOString(),
        receivedAt: row.receivedAt.toISOString(),
        staleAfterSeconds: row.staleAfterSeconds,
        isStale,
      },
    };
  }
}
