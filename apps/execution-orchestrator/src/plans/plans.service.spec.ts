import { ConflictException } from '@nestjs/common';

import { EVENT_NAMES } from '@arbibot/contracts';
import {
  ExecutionLegEntity,
  ExecutionPlanEntity,
  OutboxEventEntity,
} from '@arbibot/persistence';
import type { DataSource, EntityManager, Repository } from 'typeorm';

import type { IAuditClient } from '@arbibot/nest-platform';

import type { CapitalReservationSnapshot } from '../integration/capital-http.client';
import { CapitalHttpClient } from '../integration/capital-http.client';
import type { RiskDecisionSnapshot } from '../integration/risk-http.client';
import { RiskHttpClient } from '../integration/risk-http.client';

import { CreatePlanDto } from './dto/create-plan.dto';
import { PlansService } from './plans.service';

describe('PlansService', () => {
  let service: PlansService;
  const auditRecord = jest.fn();
  let plans: ExecutionPlanEntity[];
  let outboxRows: OutboxEventEntity[];
  let executionLegs: { planId: string; state: string }[];
  const capitalGetReservation = jest.fn<
    Promise<CapitalReservationSnapshot>,
    [string]
  >();
  const riskGetDecision = jest.fn<
    Promise<RiskDecisionSnapshot>,
    [string]
  >();

  beforeEach(() => {
    plans = [];
    outboxRows = [];
    executionLegs = [];
    capitalGetReservation.mockReset();
    riskGetDecision.mockReset();
    capitalGetReservation.mockImplementation((id: string) =>
      Promise.resolve(makeReservationSnapshot({ id })),
    );
    riskGetDecision.mockImplementation((id: string) =>
      Promise.resolve(makeRiskSnapshot({ id })),
    );

    const em = {
      create: jest.fn((_Entity: unknown, row: object) => ({ ...row })),
      find: jest.fn(
        (Entity: unknown, opts: { where: { planId?: string } }) => {
          if (Entity === ExecutionLegEntity) {
            const pid = opts.where.planId;
            if (pid === undefined) {
              return [];
            }
            return executionLegs.filter((l) => l.planId === pid);
          }
          return [];
        },
      ),
      findOne: jest.fn(
        (
          Entity: unknown,
          opts: {
            where: {
              id?: string;
            };
            lock?: unknown;
          },
        ) => {
          if (Entity === ExecutionPlanEntity) {
            return plans.find((p) => p.id === opts.where.id) ?? null;
          }
          return null;
        },
      ),
      save: jest.fn(
        (
          targetOrEntity: unknown,
          maybeEntity?: ExecutionPlanEntity | OutboxEventEntity,
        ) => {
          const entity = (maybeEntity ?? targetOrEntity) as
            | ExecutionPlanEntity
            | OutboxEventEntity;
          if ('eventType' in entity) {
            outboxRows.push(entity);
            return entity;
          }
          if ('capitalReservationId' in entity) {
            const idx = plans.findIndex((p) => p.id === entity.id);
            if (idx >= 0) {
              plans[idx] = entity;
            } else {
              plans.push(entity);
            }
          }
          return entity;
        },
      ),
    } as unknown as EntityManager;

    const dataSource = {
      transaction: jest.fn(async (fn: (m: EntityManager) => Promise<unknown>) => {
        return fn(em);
      }),
    } as unknown as DataSource;

    const plansRepo = {
      create: jest.fn((row: object) => ({ ...row })),
      save: jest.fn((row: ExecutionPlanEntity) => {
        const entity = {
          ...row,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        } as ExecutionPlanEntity;
        plans.push(entity);
        return entity;
      }),
      find: jest.fn(() => plans),
      findOne: jest.fn(({ where }: { where: { id: string } }) => {
        return plans.find((p) => p.id === where.id) ?? null;
      }),
    } as unknown as Repository<ExecutionPlanEntity>;

    const audit = {
      record: auditRecord,
      appendEntry: jest.fn(),
    } as unknown as IAuditClient;

    const capitalHttp = {
      getReservation: capitalGetReservation,
    } as unknown as CapitalHttpClient;
    const riskHttp = {
      getRiskDecision: riskGetDecision,
    } as unknown as RiskHttpClient;

    service = new PlansService(
      dataSource,
      plansRepo,
      audit,
      capitalHttp,
      riskHttp,
    );
  });

  function makePlan(overrides: Partial<ExecutionPlanEntity> = {}): ExecutionPlanEntity {
    return {
      id: '11111111-1111-4111-8111-111111111111',
      correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      state: 'planned',
      capitalReservationId: null,
      riskDecisionId: '22222222-2222-4222-8222-222222222222',
      routeKey: null,
      entityVersion: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      legs: [],
      ...overrides,
    };
  }

  function makeReservationSnapshot(
    overrides: Partial<CapitalReservationSnapshot> = {},
  ): CapitalReservationSnapshot {
    return {
      id: '33333333-3333-4333-8333-333333333333',
      planId: '11111111-1111-4111-8111-111111111111',
      correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      state: 'active',
      expiresAtIso: new Date(Date.now() + 60_000).toISOString(),
      ...overrides,
    };
  }

  function makeRiskSnapshot(
    overrides: Partial<RiskDecisionSnapshot> = {},
  ): RiskDecisionSnapshot {
    return {
      id: '22222222-2222-4222-8222-222222222222',
      correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      outcome: 'approved',
      ...overrides,
    };
  }

  it('creates a planned execution plan', async () => {
    const dto = new CreatePlanDto();
    dto.correlationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    dto.riskDecisionId = '22222222-2222-4222-8222-222222222222';
    dto.routeKey = 'arb:test:route:1';

    const row = await service.create(dto);

    expect(row.state).toBe('planned');
    expect(row.riskDecisionId).toBe(dto.riskDecisionId);
    expect(row.routeKey).toBe('arb:test:route:1');
  });

  it('rejects linkReservation without approved risk decision', async () => {
    plans.push(makePlan({ riskDecisionId: null }));

    await expect(
      service.linkReservation(
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toThrow(ConflictException);
    expect(capitalGetReservation).not.toHaveBeenCalled();
  });

  it('rejects linkReservation when reservation is not pre-linked to the plan', async () => {
    plans.push(makePlan());
    riskGetDecision.mockResolvedValue(makeRiskSnapshot());
    capitalGetReservation.mockResolvedValue(
      makeReservationSnapshot({ planId: null }),
    );

    await expect(
      service.linkReservation(
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toThrow('must be linked to plan');
  });

  it('links reservation when risk is approved and reservation belongs to the plan', async () => {
    plans.push(makePlan());
    riskGetDecision.mockResolvedValue(makeRiskSnapshot());
    capitalGetReservation.mockResolvedValue(makeReservationSnapshot());

    const row = await service.linkReservation(
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
    );

    expect(row.state).toBe('reserved');
    expect(row.capitalReservationId).toBe(
      '33333333-3333-4333-8333-333333333333',
    );
    expect(riskGetDecision).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(capitalGetReservation).toHaveBeenCalledTimes(2);
    expect(capitalGetReservation).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
    );
  });

  it('rejects arm when risk decision is not approved', async () => {
    plans.push(
      makePlan({
        state: 'reserved',
        capitalReservationId: '33333333-3333-4333-8333-333333333333',
      }),
    );
    riskGetDecision.mockResolvedValue(makeRiskSnapshot({ outcome: 'rejected' }));
    capitalGetReservation.mockResolvedValue(makeReservationSnapshot());

    await expect(
      service.arm('11111111-1111-4111-8111-111111111111'),
    ).rejects.toThrow('must be approved');
    expect(capitalGetReservation).not.toHaveBeenCalled();
  });

  it('arms plan and writes PlanArmed outbox in the same transaction', async () => {
    plans.push(
      makePlan({
        state: 'reserved',
        capitalReservationId: '33333333-3333-4333-8333-333333333333',
        entityVersion: 1,
      }),
    );
    riskGetDecision.mockResolvedValue(makeRiskSnapshot());
    capitalGetReservation.mockResolvedValue(makeReservationSnapshot());

    const row = await service.arm('11111111-1111-4111-8111-111111111111');

    expect(row.state).toBe('armed');
    expect(row.entityVersion).toBe(2);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.eventType).toBe(EVENT_NAMES.planArmed);
    expect(outboxRows[0]?.entityId).toBe(row.id);
    const payload = outboxRows[0]?.payload as Record<string, unknown>;
    expect(payload.state).toBe('armed');
    expect(payload.capitalReservationId).toBe('33333333-3333-4333-8333-333333333333');
    expect(payload.riskDecisionId).toBe('22222222-2222-4222-8222-222222222222');
    expect(payload.entityVersion).toBe(2);
    expect(capitalGetReservation).toHaveBeenCalledTimes(2);
  });

  it('tryMarkPlanCompletedWhenAllLegsFilled completes executing plan', async () => {
    plans.push(
      makePlan({
        state: 'executing',
        capitalReservationId: '33333333-3333-4333-8333-333333333333',
      }),
    );
    executionLegs.push({
      planId: '11111111-1111-4111-8111-111111111111',
      state: 'filled',
    });
    const r = await service.tryMarkPlanCompletedWhenAllLegsFilled(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(r.completed).toBe(true);
    expect(r.plan?.state).toBe('completed');
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.eventType).toBe(EVENT_NAMES.planCompleted);
    expect((outboxRows[0]?.payload as { planId?: string }).planId).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('tryMarkPlanCompletedWhenAllLegsFilled no-op when a leg is not filled', async () => {
    plans.push(makePlan({ state: 'executing' }));
    executionLegs.push(
      { planId: '11111111-1111-4111-8111-111111111111', state: 'filled' },
      { planId: '11111111-1111-4111-8111-111111111111', state: 'sent' },
    );
    const r = await service.tryMarkPlanCompletedWhenAllLegsFilled(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(r.completed).toBe(false);
  });
});
