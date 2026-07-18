import { ConflictException, NotFoundException } from '@nestjs/common';
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
  // Loose typing: the mock only implements transaction()/getRepository(),
  // but TypeORM's overloaded signatures (isolationLevel variant, EntityTarget
  // generic) make a strict jest.Mocked<Pick<DataSource,...>> assignment fail.
  // Casts to DataSource happen at the single construction site below.
  let dataSource: {
    transaction: jest.Mock;
    getRepository: jest.Mock;
  };
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
    };

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

  describe('throttle / validation branches', () => {
    it('returns throttled result with audit when throttle.requireAudit=true', async () => {
      const audit = { record: jest.fn(), appendEntry: jest.fn() };
      const throttleWithAudit = {
        evaluate: jest.fn().mockResolvedValue({
          allow: false,
          reason: 'warm_sampling',
          routingTier: 'warm',
          requireAudit: true,
        }),
      };
      const svc = new SnapshotsService(
        dataSource as unknown as DataSource,
        throttleWithAudit as never,
        audit as never,
      );
      const out = await svc.ingest({
        venueCode: 'BINANCE',
        venueSymbol: 'BTCUSDT',
        observedAt: '2026-04-10T12:00:00.000Z',
        instrumentKey: 'BTC',
        routeKey: 'BTC-USDT',
      });
      expect(out.throttled).toBe(true);
      expect(out.snapshotId).toBe('');
      expect(out.entityVersion).toBe(0);
      expect(out.throttleReason).toBe('warm_sampling');
      // audit was called with INTAKE_SNAPSHOT_THROTTLED and the routing context
      expect(audit.record).toHaveBeenCalledTimes(1);
      const entry = audit.record.mock.calls[0]?.[0] as {
        action: string;
        payload: { reason: string; routingTier: string };
      };
      expect(entry.action).toBe('INTAKE_SNAPSHOT_THROTTLED');
      expect(entry.payload.reason).toBe('warm_sampling');
      expect(entry.payload.routingTier).toBe('warm');
    });

    it('returns throttled result without audit when throttle.requireAudit=false', async () => {
      const audit = { record: jest.fn(), appendEntry: jest.fn() };
      const throttleNoAudit = {
        evaluate: jest.fn().mockResolvedValue({
          allow: false,
          reason: 'cold_sampling',
          routingTier: 'cold',
          requireAudit: false,
        }),
      };
      const svc = new SnapshotsService(
        dataSource as unknown as DataSource,
        throttleNoAudit as never,
        audit as never,
      );
      const out = await svc.ingest({
        venueCode: 'BINANCE',
        venueSymbol: 'BTCUSDT',
        observedAt: '2026-04-10T12:00:00.000Z',
      });
      expect(out.throttled).toBe(true);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when observedAt is invalid', async () => {
      await expect(
        service.ingest({
          venueCode: 'BINANCE',
          venueSymbol: 'BTCUSDT',
          observedAt: 'not-a-date',
        }),
      ).rejects.toBeInstanceOf(Error);
    });
  });

  describe('update path (existing snapshot)', () => {
    it('bumps entityVersion and writes outbox when content differs', async () => {
      snapshots.push({
        id: 'snap-existing',
        venueCode: 'BINANCE',
        venueSymbol: 'BTCUSDT',
        canonicalInstrumentId: null,
        bid: '100',
        ask: '101',
        last: null,
        payload: {},
        observedAt: new Date('2026-04-10T10:00:00.000Z'),
        receivedAt: new Date('2026-04-10T10:00:00.000Z'),
        staleAfterSeconds: null,
        entityVersion: 1,
      });
      const out = await service.ingest({
        venueCode: 'BINANCE',
        venueSymbol: 'BTCUSDT',
        observedAt: '2026-04-10T12:00:00.000Z',
        bid: 110,
        ask: 111,
      });
      expect(out.unchanged).toBe(false);
      expect(out.entityVersion).toBe(2);
      expect(savedOutbox).toHaveLength(1);
    });

    it('marks unchanged when observedAt and content match exactly', async () => {
      const observedAtIso = '2026-04-10T12:00:00.000Z';
      snapshots.push({
        id: 'snap-existing',
        venueCode: 'BINANCE',
        venueSymbol: 'BTCUSDT',
        canonicalInstrumentId: null,
        bid: '100',
        ask: '101',
        last: null,
        payload: { k: 'v' },
        observedAt: new Date(observedAtIso),
        receivedAt: new Date('2026-04-10T11:00:00.000Z'),
        staleAfterSeconds: 60,
        entityVersion: 5,
      });
      const out = await service.ingest({
        venueCode: 'BINANCE',
        venueSymbol: 'BTCUSDT',
        observedAt: observedAtIso,
        bid: 100,
        ask: 101,
        payload: { k: 'v' },
        staleAfterSeconds: 60,
      });
      expect(out.unchanged).toBe(true);
      expect(out.entityVersion).toBe(5);
      expect(savedOutbox).toHaveLength(0);
    });

    it('persists idempotency row on unchanged content when idempotencyKey provided', async () => {
      const observedAtIso = '2026-04-10T12:00:00.000Z';
      snapshots.push({
        id: 'snap-existing',
        venueCode: 'X',
        venueSymbol: 'Y',
        canonicalInstrumentId: null,
        bid: '100',
        ask: null,
        last: null,
        payload: {},
        observedAt: new Date(observedAtIso),
        receivedAt: new Date(observedAtIso),
        staleAfterSeconds: null,
        entityVersion: 2,
      });
      const out = await service.ingest({
        idempotencyKey: 'aaaa1111-bbbb-4ccc-dddd-eeeeeeeeeeee',
        venueCode: 'X',
        venueSymbol: 'Y',
        observedAt: observedAtIso,
        bid: 100,
      });
      expect(out.unchanged).toBe(true);
      expect(idempotencyRows).toHaveLength(1);
      expect(idempotencyRows[0]?.unchanged).toBe(true);
    });

    it('throws when retry budget is exhausted by repeated unique violations', async () => {
      const mkUniqueError = () => {
        const e = new QueryFailedError('q', [], new Error('dup'));
        Object.assign(e, { driverError: { code: '23505' } });
        return e;
      };
      const failing = jest.fn().mockImplementation(() =>
        Promise.reject(mkUniqueError()),
      );
      Object.assign(dataSource, { transaction: failing });

      await expect(
        service.ingest({
          venueCode: 'X',
          venueSymbol: 'Y',
          observedAt: '2026-04-10T12:00:00.000Z',
        }),
      ).rejects.toBeInstanceOf(QueryFailedError);
    });

    it('rethrows non-unique-violation errors without retry', async () => {
      const failing = jest
        .fn()
        .mockRejectedValue(new Error('deadlock detection'));
      Object.assign(dataSource, { transaction: failing });

      await expect(
        service.ingest({
          venueCode: 'X',
          venueSymbol: 'Y',
          observedAt: '2026-04-10T12:00:00.000Z',
        }),
      ).rejects.toThrow('deadlock detection');
      expect(failing).toHaveBeenCalledTimes(1);
    });
  });

  describe('findFresh', () => {
    /**
     * findFresh reads from the DataSource's MarketSnapshotEntity repository
     * directly (not via the in-memory `snapshots` array used by ingest). We
     * swap the getRepository mock to return a `find()` that surfaces the
     * in-memory array so the service's stale-filter logic can be exercised.
     */
    const withFind = () => {
      Object.assign(dataSource, {
        getRepository: jest.fn((Entity: object) => {
          if (Entity === MarketSnapshotEntity) {
            return {
              findOne: jest.fn(
                ({
                  where,
                }: {
                  where: { venueCode: string; venueSymbol: string };
                }) =>
                  snapshots.find(
                    (s) =>
                      s.venueCode === where.venueCode &&
                      s.venueSymbol === where.venueSymbol,
                  ) ?? null,
              ),
              // find() must return a Promise<T[]>; we resolve with a snapshot
              // of the in-memory array each call so the service can filter.
              find: jest.fn().mockResolvedValue([...snapshots]),
            };
          }
          return {
            findOne: jest.fn(),
            find: jest.fn().mockResolvedValue([]),
          };
        }),
      });
    };

    it('returns fresh snapshots, excluding stale ones', async () => {
      withFind();
      const freshTs = new Date();
      const staleTs = new Date(Date.now() - 120_000);
      snapshots.push(
        {
          id: 'fresh-1',
          venueCode: 'BINANCE',
          venueSymbol: 'BTCUSDT',
          canonicalInstrumentId: null,
          bid: '100',
          ask: '101',
          last: null,
          payload: { instrumentKey: 'BTC', routeKey: 'BTC-USDT' },
          observedAt: freshTs,
          receivedAt: freshTs,
          staleAfterSeconds: null, // never stale
          entityVersion: 1,
        },
        {
          id: 'stale-1',
          venueCode: 'COINBASE',
          venueSymbol: 'BTCUSD',
          canonicalInstrumentId: null,
          bid: '100',
          ask: '101',
          last: null,
          payload: {},
          observedAt: staleTs,
          receivedAt: staleTs,
          staleAfterSeconds: 30, // past staleAfter
          entityVersion: 1,
        },
      );
      const out = await service.findFresh(10);
      expect(out.total).toBe(1);
      expect(out.items[0]?.id).toBe('fresh-1');
      expect(out.items[0]?.instrumentKey).toBe('BTC');
      expect(out.items[0]?.routeKey).toBe('BTC-USDT');
      expect(out.items[0]?.bid).toBe(100);
      expect(out.items[0]?.ask).toBe(101);
      expect(out.items[0]?.isStale).toBe(false);
    });

    it('includes snapshots with staleAfterSeconds <= 0', async () => {
      withFind();
      const freshTs = new Date();
      snapshots.push({
        id: 'fresh-1',
        venueCode: 'BINANCE',
        venueSymbol: 'BTCUSDT',
        canonicalInstrumentId: null,
        bid: null,
        ask: null,
        last: null,
        payload: {},
        observedAt: freshTs,
        receivedAt: freshTs,
        staleAfterSeconds: 0, // explicit zero → never stale
        entityVersion: 1,
      });
      const out = await service.findFresh(10);
      expect(out.total).toBe(1);
    });

    it('returns empty when no snapshots exist', async () => {
      withFind();
      const out = await service.findFresh(10);
      expect(out.items).toEqual([]);
      expect(out.total).toBe(0);
    });
  });

  describe('getOne edge cases', () => {
    it('throws NotFoundException when snapshot is missing', async () => {
      await expect(service.getOne('NOPE', 'NOPE')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns isStale=false when staleAfterSeconds is null', async () => {
      const fresh = new Date();
      snapshots.push({
        id: 's1',
        venueCode: 'X',
        venueSymbol: 'Y',
        canonicalInstrumentId: 'instr-1',
        bid: '100',
        ask: '101',
        last: '100.5',
        payload: {},
        observedAt: fresh,
        receivedAt: fresh,
        staleAfterSeconds: null,
        entityVersion: 1,
      });
      const res = await service.getOne('X', 'Y');
      expect(res.freshness.isStale).toBe(false);
      expect(res.snapshot.canonicalInstrumentId).toBe('instr-1');
      expect(res.snapshot.bid).toBe(100);
      expect(res.snapshot.last).toBe(100.5);
    });

    it('returns isStale=false when staleAfterSeconds is 0', async () => {
      const fresh = new Date();
      snapshots.push({
        id: 's1',
        venueCode: 'X',
        venueSymbol: 'Y',
        canonicalInstrumentId: null,
        bid: null,
        ask: null,
        last: null,
        payload: {},
        observedAt: fresh,
        receivedAt: fresh,
        staleAfterSeconds: 0,
        entityVersion: 1,
      });
      const res = await service.getOne('X', 'Y');
      expect(res.freshness.isStale).toBe(false);
    });
  });
});
