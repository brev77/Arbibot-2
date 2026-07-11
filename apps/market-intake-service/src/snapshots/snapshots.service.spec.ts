import { ConflictException } from '@nestjs/common';
import { EVENT_NAMES } from '@arbibot/contracts';
import {
  MarketSnapshotEntity,
  MarketSnapshotIngestIdempotencyEntity,
  OutboxEventEntity,
} from '@arbibot/persistence';
import type { DataSource, EntityManager } from 'typeorm';
import { QueryFailedError } from 'typeorm';

import { SnapshotsService } from './snapshots.service';

jest.mock('@arbibot/nest-platform', () => {
  const actual = jest.requireActual<typeof import('@arbibot/nest-platform')>(
    '@arbibot/nest-platform',
  );
  return {
    ...actual,
    getCorrelationId: jest.fn(() => '00000000-0000-4000-8000-000000000001'),
  };
});

const mockThrottle = {
  evaluate: jest.fn().mockResolvedValue({
    allow: true,
    reason: 'throttling_disabled',
    routingTier: 'hot',
  }),
};

describe('SnapshotsService', () => {
  let service: SnapshotsService;
  let dataSource: jest.Mocked<Pick<DataSource, 'transaction' | 'getRepository'>>;
  const snapshots: MarketSnapshotEntity[] = [];
  const idempotencyRows: MarketSnapshotIngestIdempotencyEntity[] = [];
  let savedOutbox: OutboxEventEntity[] = [];

  const mkEm = (): EntityManager =>
    ({
      query: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn(
        (
          Entity: object,
          opts?: { where: { idempotencyKey?: string } },
        ) => {
          if (Entity === MarketSnapshotIngestIdempotencyEntity) {
            const k = opts?.where.idempotencyKey;
            return (
              idempotencyRows.find((r) => r.idempotencyKey === k) ?? null
            );
          }
          return null;
        },
      ),
      getRepository: jest.fn((Entity: object) => {
        if (Entity === MarketSnapshotEntity) {
          return {
            findOne: jest.fn(
              ({
                where,
              }: {
                where: { venueCode: string; venueSymbol: string };
              }) => {
                return (
                  snapshots.find(
                    (s) =>
                      s.venueCode === where.venueCode &&
                      s.venueSymbol === where.venueSymbol,
                  ) ?? null
                );
              },
            ),
          };
        }
        return { findOne: jest.fn() };
      }),
      create: jest.fn((Entity: object, o: object) => {
        if (Entity === MarketSnapshotEntity) {
          return { ...o, id: 'snap-new' };
        }
        if (Entity === OutboxEventEntity) {
          return { ...o };
        }
        if (Entity === MarketSnapshotIngestIdempotencyEntity) {
          return { ...o };
        }
        return { ...o };
      }),
      save: jest.fn((a: unknown, b?: unknown) => {
        const entity = (b !== undefined ? b : a) as Record<string, unknown>;
        if (
          entity &&
          'eventType' in entity &&
          typeof entity.eventType === 'string'
        ) {
          savedOutbox.push(entity as unknown as OutboxEventEntity);
          return entity;
        }
        if (
          entity &&
          'idempotencyKey' in entity &&
          'requestHash' in entity
        ) {
          idempotencyRows.push(
            entity as unknown as MarketSnapshotIngestIdempotencyEntity,
          );
          return entity;
        }
        const snap = entity as unknown as MarketSnapshotEntity;
        if ('venueCode' in snap && 'venueSymbol' in snap) {
          const idx = snapshots.findIndex((s) => s.id === snap.id);
          if (idx >= 0) {
            snapshots[idx] = snap;
          } else {
            const withId = {
              ...snap,
              id: snap.id ?? 'snap-1',
            };
            snapshots.push(withId);
            return withId;
          }
          return snap;
        }
        return entity;
      }),
    }) as unknown as EntityManager;

  beforeEach(() => {
    snapshots.length = 0;
    idempotencyRows.length = 0;
    savedOutbox = [];
    dataSource = {
      transaction: jest.fn(async (fn: (em: EntityManager) => Promise<unknown>) => {
        return fn(mkEm());
      }),
      getRepository: jest.fn((Entity: object) => {
        if (Entity === MarketSnapshotEntity) {
          return {
            findOne: jest.fn(
              ({
                where,
              }: {
                where: { venueCode: string; venueSymbol: string };
              }) => {
                return (
                  snapshots.find(
                    (s) =>
                      s.venueCode === where.venueCode &&
                      s.venueSymbol === where.venueSymbol,
                  ) ?? null
                );
              },
            ),
          };
        }
        return { findOne: jest.fn() };
      }),
    } as unknown as jest.Mocked<Pick<DataSource, 'transaction' | 'getRepository'>>;

    const audit = { record: jest.fn(), appendEntry: jest.fn() };
    service = new SnapshotsService(
      dataSource as unknown as DataSource,
      mockThrottle as never,
      audit as never,
    );
  });

  it('ingest creates snapshot and SnapshotUpdated outbox row (schema v2)', async () => {
    const out = await service.ingest({
      venueCode: 'BINANCE',
      venueSymbol: 'BTCUSDT',
      observedAt: '2026-04-10T12:00:00.000Z',
      bid: 100,
      ask: 101,
    });
    expect(out.snapshotId).toBeDefined();
    expect(out.outboxMessageId).toBeDefined();
    expect(out.unchanged).toBe(false);
    expect(savedOutbox).toHaveLength(1);
    expect(savedOutbox[0]?.eventType).toBe(EVENT_NAMES.snapshotUpdated);
    expect(savedOutbox[0]?.schemaVersion).toBe(2);
  });

  it('replays ingest when idempotency key matches same payload', async () => {
    const key = '7ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const dto = {
      idempotencyKey: key,
      venueCode: 'BINANCE',
      venueSymbol: 'BTCUSDT',
      observedAt: '2026-04-10T12:00:00.000Z',
      bid: 100,
      ask: 101,
    };
    const first = await service.ingest(dto);
    const second = await service.ingest(dto);
    expect(second.idempotentReplay).toBe(true);
    expect(second.snapshotId).toBe(first.snapshotId);
    expect(second.outboxMessageId).toBe(first.outboxMessageId);
    expect(savedOutbox).toHaveLength(1);
  });

  it('conflicts when idempotency key matches different payload', async () => {
    const key = '8ba7b810-9dad-11d1-80b4-00c04fd430c8';
    await service.ingest({
      idempotencyKey: key,
      venueCode: 'BINANCE',
      venueSymbol: 'BTCUSDT',
      observedAt: '2026-04-10T12:00:00.000Z',
      bid: 100,
    });
    await expect(
      service.ingest({
        idempotencyKey: key,
        venueCode: 'BINANCE',
        venueSymbol: 'BTCUSDT',
        observedAt: '2026-04-10T12:00:00.000Z',
        bid: 200,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not append outbox when observedAt is older than stored', async () => {
    snapshots.push({
      id: 's1',
      venueCode: 'BINANCE',
      venueSymbol: 'BTCUSDT',
      canonicalInstrumentId: null,
      bid: '100',
      ask: '101',
      last: null,
      payload: {},
      observedAt: new Date('2026-04-10T14:00:00.000Z'),
      receivedAt: new Date('2026-04-10T14:00:00.000Z'),
      staleAfterSeconds: null,
      entityVersion: 3,
    });
    const out = await service.ingest({
      venueCode: 'BINANCE',
      venueSymbol: 'BTCUSDT',
      observedAt: '2026-04-10T12:00:00.000Z',
      bid: 50,
    });
    expect(out.unchanged).toBe(true);
    expect(out.outboxMessageId).toBeNull();
    expect(savedOutbox).toHaveLength(0);
    expect(snapshots[0]?.entityVersion).toBe(3);
    expect(snapshots[0]?.bid).toBe('100');
  });

  it('retries transaction on unique violation', async () => {
    let calls = 0;
    Object.assign(dataSource, {
      transaction: jest.fn(
        async (fn: (em: EntityManager) => Promise<unknown>) => {
          calls++;
          if (calls === 1) {
            const e = new QueryFailedError('q', [], new Error('dup'));
            Object.assign(e, { driverError: { code: '23505' } });
            throw e;
          }
          return fn(mkEm());
        },
      ),
    });

    const out = await service.ingest({
      venueCode: 'X',
      venueSymbol: 'Y',
      observedAt: '2026-04-10T12:00:00.000Z',
    });
    expect(calls).toBe(2);
    expect(out.snapshotId).toBeDefined();
    expect(savedOutbox).toHaveLength(1);
  });

  it('getOne returns freshness.isStale when past observedAt + stale window', async () => {
    const past = new Date(Date.now() - 120_000);
    snapshots.push({
      id: 's1',
      venueCode: 'X',
      venueSymbol: 'Y',
      canonicalInstrumentId: null,
      bid: null,
      ask: null,
      last: null,
      payload: {},
      observedAt: past,
      receivedAt: past,
      staleAfterSeconds: 30,
      entityVersion: 1,
    });
    const res = await service.getOne('X', 'Y');
    expect(res.freshness.isStale).toBe(true);
  });
});
