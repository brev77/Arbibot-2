import { ConflictException } from '@nestjs/common';
import { AuditLogEntity } from '@arbibot/persistence';
import { QueryFailedError, type DataSource, type EntityManager, type Repository } from 'typeorm';

import type { AppendAuditDto } from './dto/append-audit.dto';
import { AuditService } from './audit.service';

/**
 * Pattern A: in-memory fake EntityManager + pass-through DataSource.transaction.
 * Mirrors apps/execution-orchestrator/src/legs/legs.service.spec.ts.
 */
describe('AuditService', () => {
  let service: AuditService;
  let rows: AuditLogEntity[];
  let repoCreateSpy: jest.Mock;
  let repoSaveSpy: jest.Mock;
  let repoFindSpy: jest.Mock;
  let emOne: jest.Mock;
  let emSaveSpy: jest.Mock;
  let emCreateSpy: jest.Mock;

  /** Builds a minimal DTO with sensible defaults; `over` overrides individual fields. */
  function dto(over: Partial<AppendAuditDto> = {}): AppendAuditDto {
    return {
      actor: 'operator-1',
      action: 'PLAN_ARMED',
      ...over,
    };
  }

  /** Builds a stored AuditLogEntity row (with assigned id + createdAt). */
  function row(over: Partial<AuditLogEntity> = {}): AuditLogEntity {
    return {
      id: over.id ?? `row-${rows.length + 1}`,
      correlationId: over.correlationId ?? null,
      actor: over.actor ?? 'operator-1',
      action: over.action ?? 'PLAN_ARMED',
      resourceType: over.resourceType ?? null,
      resourceId: over.resourceId ?? null,
      idempotencyKey: over.idempotencyKey ?? null,
      payload: over.payload ?? null,
      createdAt: over.createdAt ?? new Date('2026-01-01T00:00:00Z'),
    };
  }

  beforeEach(() => {
    rows = [];
    jest.clearAllMocks();

    // Fake EntityManager: dispatches by Entity === AuditLogEntity.
    emOne = jest.fn(
      (
        Entity: unknown,
        opts: { where: { idempotencyKey?: string } },
      ): Promise<AuditLogEntity | null> => {
        if (Entity !== AuditLogEntity) return Promise.resolve(null);
        const found = opts.where.idempotencyKey
          ? rows.find((r) => r.idempotencyKey === opts.where.idempotencyKey)
          : null;
        return Promise.resolve(found ?? null);
      },
    );
    emCreateSpy = jest.fn((_Entity: unknown, partial: object) => ({ ...partial }));
    emSaveSpy = jest.fn(
      (Entity: unknown, rowToSave: AuditLogEntity): Promise<AuditLogEntity> => {
        if (Entity !== AuditLogEntity) return Promise.resolve(rowToSave);
        const stored: AuditLogEntity = {
          ...rowToSave,
          id: rowToSave.id ?? `row-${rows.length + 1}`,
          createdAt: rowToSave.createdAt ?? new Date('2026-01-01T00:00:00Z'),
        };
        rows.push(stored);
        return Promise.resolve(stored);
      },
    );
    const em = {
      findOne: emOne,
      create: emCreateSpy,
      save: emSaveSpy,
    } as unknown as EntityManager;

    const dataSource = {
      transaction: jest.fn(
        async (fn: (m: EntityManager) => Promise<unknown>) => fn(em),
      ),
    } as unknown as DataSource;

    // Repository (used only in the no-key path + recent()).
    repoCreateSpy = jest.fn((partial: object) => ({ ...partial }));
    repoSaveSpy = jest.fn((entity: AuditLogEntity): Promise<AuditLogEntity> => {
      const stored: AuditLogEntity = {
        ...entity,
        id: entity.id ?? `row-${rows.length + 1}`,
        createdAt: entity.createdAt ?? new Date('2026-01-01T00:00:00Z'),
      };
      rows.push(stored);
      return Promise.resolve(stored);
    });
    repoFindSpy = jest.fn((): Promise<AuditLogEntity[]> =>
      Promise.resolve([...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
    );
    const repo = {
      create: repoCreateSpy,
      save: repoSaveSpy,
      find: repoFindSpy,
    } as unknown as Repository<AuditLogEntity>;

    service = new AuditService(dataSource, repo);
  });

  describe('append — no idempotency key (plain append-only)', () => {
    it('persists entity via repository.save and returns replay:false', async () => {
      const result = await service.append(dto());

      expect(result.replay).toBe(false);
      expect(result.entity.actor).toBe('operator-1');
      expect(result.entity.action).toBe('PLAN_ARMED');
      expect(result.entity.idempotencyKey).toBeNull();
      // Repository path used (not DataSource.transaction).
      expect(repoCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: 'operator-1',
          action: 'PLAN_ARMED',
          correlationId: null,
          resourceType: null,
          resourceId: null,
          payload: null,
          idempotencyKey: null,
        }),
      );
      expect(repoSaveSpy).toHaveBeenCalledTimes(1);
    });

    it('coerces undefined optional fields to null', async () => {
      const result = await service.append({
        actor: 'op-2',
        action: 'A',
        correlationId: 'corr-1',
        resourceType: 'plan',
        resourceId: 'plan-1',
        payload: { foo: 1 },
      });

      expect(result.entity.correlationId).toBe('corr-1');
      expect(result.entity.resourceType).toBe('plan');
      expect(result.entity.resourceId).toBe('plan-1');
      expect(result.entity.payload).toEqual({ foo: 1 });
    });
  });

  describe('append — with idempotency key (transactional)', () => {
    it('replays when existing row has matching payload (no second write)', async () => {
      rows.push(
        row({
          idempotencyKey: '11111111-1111-4111-8111-111111111111',
          actor: 'operator-1',
          action: 'PLAN_ARMED',
          payload: { a: 1 },
        }),
      );

      const result = await service.append(
        dto({
          idempotencyKey: '11111111-1111-4111-8111-111111111111',
          payload: { a: 1 },
        }),
      );

      expect(result.replay).toBe(true);
      expect(result.entity.idempotencyKey).toBe('11111111-1111-4111-8111-111111111111');
      expect(emSaveSpy).not.toHaveBeenCalled();
    });

    it('throws ConflictException when payload differs for the same key', async () => {
      rows.push(
        row({
          idempotencyKey: '22222222-2222-4222-8222-222222222222',
          actor: 'operator-1',
          action: 'PLAN_ARMED',
          payload: { a: 1 },
        }),
      );

      await expect(
        service.append(
          dto({
            idempotencyKey: '22222222-2222-4222-8222-222222222222',
            actor: 'operator-1',
            action: 'PLAN_ARMED',
            payload: { a: 2 }, // differs
          }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException when actor differs for the same key', async () => {
      rows.push(
        row({
          idempotencyKey: '33333333-3333-4333-8333-333333333333',
          actor: 'operator-1',
          action: 'PLAN_ARMED',
        }),
      );

      await expect(
        service.append(
          dto({
            idempotencyKey: '33333333-3333-4333-8333-333333333333',
            actor: 'intruder', // differs
            action: 'PLAN_ARMED',
          }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('inserts new row when key is unique (replay:false)', async () => {
      const result = await service.append(
        dto({ idempotencyKey: '44444444-4444-4444-8444-444444444444' }),
      );

      expect(result.replay).toBe(false);
      expect(emSaveSpy).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.idempotencyKey).toBe('44444444-4444-4444-8444-444444444444');
    });

    it('handles 23505 unique-violation race by re-finding and replaying', async () => {
      // Simulate concurrent insert: first findOne misses, em.save throws 23505,
      // second findOne finds the row that won the race.
      let findOneCall = 0;
      emOne.mockImplementation((): Promise<AuditLogEntity | null> => {
        findOneCall += 1;
        if (findOneCall === 1) return Promise.resolve(null); // initial lookup: not found
        // second lookup (after 23505): row present
        return Promise.resolve(
          row({
            idempotencyKey: '55555555-5555-4555-8555-555555555555',
            actor: 'operator-1',
            action: 'PLAN_ARMED',
            payload: { race: true },
          }),
        );
      });
      const pgUniqueErr = new QueryFailedError(
        'INSERT ...',
        [],
        new Error('duplicate key value'),
      );
      Object.assign(pgUniqueErr, { driverError: { code: '23505' } });
      emSaveSpy.mockRejectedValueOnce(pgUniqueErr);

      const result = await service.append(
        dto({
          idempotencyKey: '55555555-5555-4555-8555-555555555555',
          payload: { race: true },
        }),
      );

      expect(result.replay).toBe(true);
      expect(emOne).toHaveBeenCalledTimes(2);
    });

    it('rethrows 23505 when re-find after violation returns null (defensive)', async () => {
      emOne.mockResolvedValue(null); // always missing
      const pgUniqueErr = new QueryFailedError('INSERT ...', [], new Error('dup'));
      Object.assign(pgUniqueErr, { driverError: { code: '23505' } });
      emSaveSpy.mockRejectedValueOnce(pgUniqueErr);

      await expect(
        service.append(dto({ idempotencyKey: '66666666-6666-4666-8666-666666666666' })),
      ).rejects.toBe(pgUniqueErr);
    });

    it('rethrows non-PG errors as-is (not 23505)', async () => {
      emOne.mockResolvedValue(null);
      const otherErr = new Error('connection lost');
      emSaveSpy.mockRejectedValueOnce(otherErr);

      await expect(
        service.append(dto({ idempotencyKey: '77777777-7777-4777-8777-777777777777' })),
      ).rejects.toBe(otherErr);
    });

    it('throws ConflictException when 23505 race finds a row with differing payload', async () => {
      let findOneCall = 0;
      emOne.mockImplementation((): Promise<AuditLogEntity | null> => {
        findOneCall += 1;
        if (findOneCall === 1) return Promise.resolve(null);
        return Promise.resolve(
          row({
            idempotencyKey: '88888888-8888-4888-8888-888888888888',
            actor: 'operator-1',
            action: 'PLAN_ARMED',
            payload: { actual: 'winner' },
          }),
        );
      });
      const pgUniqueErr = new QueryFailedError('INSERT ...', [], new Error('dup'));
      Object.assign(pgUniqueErr, { driverError: { code: '23505' } });
      emSaveSpy.mockRejectedValueOnce(pgUniqueErr);

      await expect(
        service.append(
          dto({
            idempotencyKey: '88888888-8888-4888-8888-888888888888',
            payload: { actual: 'loser' }, // differs from race-winner
          }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('recent', () => {
    it('clamps limit to >= 1', async () => {
      await service.recent(0);
      const call = repoFindSpy.mock.calls[0][0];
      expect(call.take).toBe(1);
    });

    it('clamps limit to <= 500', async () => {
      await service.recent(10_000);
      const call = repoFindSpy.mock.calls[0][0];
      expect(call.take).toBe(500);
    });

    it('preserves in-range limit', async () => {
      await service.recent(50);
      const call = repoFindSpy.mock.calls[0][0];
      expect(call.take).toBe(50);
    });

    it('orders by createdAt DESC', async () => {
      await service.recent(50);
      const call = repoFindSpy.mock.calls[0][0];
      expect(call.order).toEqual({ createdAt: 'DESC' });
    });
  });
});
