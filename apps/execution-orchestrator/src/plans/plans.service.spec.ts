import { ConflictException } from '@nestjs/common';

import type {
  CapitalReservationEntity,
  ExecutionPlanEntity,
  RiskDecisionEntity,
} from '@arbibot/persistence';
import type { DataSource, EntityManager, Repository } from 'typeorm';

import { CreatePlanDto } from './dto/create-plan.dto';
import { PlansService } from './plans.service';

describe('PlansService', () => {
  let service: PlansService;
  let plans: ExecutionPlanEntity[];
  let reservations: CapitalReservationEntity[];
  let riskDecisions: RiskDecisionEntity[];
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
    } as Response);
    plans = [];
    reservations = [];
    riskDecisions = [];

    const em = {
      findOne: jest.fn(
        async (
          Entity: { name?: string },
          opts: {
            where: {
              id?: string;
            };
            lock?: unknown;
          },
        ) => {
          if (Entity.name === 'ExecutionPlanEntity') {
            return plans.find((p) => p.id === opts.where.id) ?? null;
          }
          if (Entity.name === 'CapitalReservationEntity') {
            return reservations.find((r) => r.id === opts.where.id) ?? null;
          }
          if (Entity.name === 'RiskDecisionEntity') {
            return riskDecisions.find((r) => r.id === opts.where.id) ?? null;
          }
          return null;
        },
      ),
      save: jest.fn(
        async (
          targetOrEntity: unknown,
          maybeEntity?:
            | ExecutionPlanEntity
            | CapitalReservationEntity
            | RiskDecisionEntity,
        ) => {
          const entity = (maybeEntity ?? targetOrEntity) as
            | ExecutionPlanEntity
            | CapitalReservationEntity
            | RiskDecisionEntity;
          if ('capitalReservationId' in entity) {
            const idx = plans.findIndex((p) => p.id === entity.id);
            if (idx >= 0) {
              plans[idx] = entity;
            } else {
              plans.push(entity);
            }
          } else if ('expiresAt' in entity) {
            const idx = reservations.findIndex((r) => r.id === entity.id);
            if (idx >= 0) {
              reservations[idx] = entity;
            } else {
              reservations.push(entity);
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
      save: jest.fn(async (row: ExecutionPlanEntity) => {
        const entity = {
          ...row,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        } as ExecutionPlanEntity;
        plans.push(entity);
        return entity;
      }),
      find: jest.fn(async () => plans),
      findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
        return plans.find((p) => p.id === where.id) ?? null;
      }),
    } as unknown as Repository<ExecutionPlanEntity>;

    service = new PlansService(dataSource, plansRepo);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function makePlan(overrides: Partial<ExecutionPlanEntity> = {}): ExecutionPlanEntity {
    return {
      id: '11111111-1111-4111-8111-111111111111',
      correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      state: 'planned',
      capitalReservationId: null,
      riskDecisionId: '22222222-2222-4222-8222-222222222222',
      entityVersion: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      legs: [],
      ...overrides,
    };
  }

  function makeReservation(
    overrides: Partial<CapitalReservationEntity> = {},
  ): CapitalReservationEntity {
    return {
      id: '33333333-3333-4333-8333-333333333333',
      planId: '11111111-1111-4111-8111-111111111111',
      correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      amountUsd: '1000',
      state: 'active',
      expiresAt: new Date(Date.now() + 60_000),
      entityVersion: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  function makeRiskDecision(
    overrides: Partial<RiskDecisionEntity> = {},
  ): RiskDecisionEntity {
    return {
      id: '22222222-2222-4222-8222-222222222222',
      correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      planReference: 'plan-1',
      outcome: 'approved',
      reasons: ['ok'],
      snapshotVersion: 1,
      riskMode: 'standard',
      notionalUsd: '1000',
      idempotencyKey: null,
      entityVersion: 1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  it('creates a planned execution plan', async () => {
    const dto = new CreatePlanDto();
    dto.correlationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    dto.riskDecisionId = '22222222-2222-4222-8222-222222222222';

    const row = await service.create(dto);

    expect(row.state).toBe('planned');
    expect(row.riskDecisionId).toBe(dto.riskDecisionId);
  });

  it('rejects linkReservation without approved risk decision', async () => {
    plans.push(makePlan({ riskDecisionId: null }));
    reservations.push(makeReservation());

    await expect(
      service.linkReservation(
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects linkReservation when reservation is not pre-linked to the plan', async () => {
    plans.push(makePlan());
    riskDecisions.push(makeRiskDecision());
    reservations.push(makeReservation({ planId: null }));

    await expect(
      service.linkReservation(
        '11111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toThrow('must be linked to plan');
  });

  it('links reservation when risk is approved and reservation belongs to the plan', async () => {
    plans.push(makePlan());
    riskDecisions.push(makeRiskDecision());
    reservations.push(makeReservation());

    const row = await service.linkReservation(
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
    );

    expect(row.state).toBe('reserved');
    expect(row.capitalReservationId).toBe(
      '33333333-3333-4333-8333-333333333333',
    );
    expect(reservations[0]?.planId).toBe('11111111-1111-4111-8111-111111111111');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:3011/capital/reservations/33333333-3333-4333-8333-333333333333',
      {
        method: 'GET',
        headers: { accept: 'application/json' },
      },
    );
  });

  it('rejects arm when risk decision is not approved', async () => {
    plans.push(
      makePlan({
        state: 'reserved',
        capitalReservationId: '33333333-3333-4333-8333-333333333333',
      }),
    );
    reservations.push(makeReservation());
    riskDecisions.push(makeRiskDecision({ outcome: 'rejected' }));

    await expect(
      service.arm('11111111-1111-4111-8111-111111111111'),
    ).rejects.toThrow('must be approved');
  });
});
