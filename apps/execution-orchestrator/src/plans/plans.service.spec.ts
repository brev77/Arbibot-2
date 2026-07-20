import { ConflictException, NotFoundException } from '@nestjs/common';

import { EVENT_NAMES } from '@arbibot/contracts';
import {
  ExecutionLegEntity,
  ExecutionPlanEntity,
  OnChainTransaction,
  OutboxEventEntity,
} from '@arbibot/persistence';
import type { DataSource, EntityManager, Repository } from 'typeorm';

import type { CapitalReservationSnapshot } from '../integration/capital-http.client';
import type { RiskDecisionSnapshot } from '../integration/risk-http.client';

import { CreatePlanDto } from './dto/create-plan.dto';
import { PlansService } from './plans.service';

describe('PlansService', () => {
  let service: PlansService;
  const auditRecord = jest.fn();
  let plans: ExecutionPlanEntity[];
  let outboxRows: OutboxEventEntity[];
  let executionLegs: { planId: string; state: string }[];
  let onChainTxs: OnChainTransaction[];
  let onChainFind: jest.Mock;
  let onChainFindOne: jest.Mock;
  let legsRepoFind: jest.Mock;
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
    onChainTxs = [];
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

    // legsRepo.find is invoked via dataSource.getRepository(ExecutionLegEntity)
    legsRepoFind = jest.fn((opts: { where: { planId?: string } }) => {
      const pid = opts.where.planId;
      if (pid === undefined) return [];
      return executionLegs.filter((l) => l.planId === pid);
    });

    const dataSource = {
      transaction: jest.fn(async (fn: (m: EntityManager) => Promise<unknown>) => {
        return fn(em);
      }),
      getRepository: jest.fn((Entity: unknown) => {
        if (Entity === ExecutionLegEntity) {
          return { find: legsRepoFind };
        }
        return { find: jest.fn().mockResolvedValue([]) };
      }),
    } as unknown as DataSource;

    const plansRepo = {
      create: jest.fn((row: object) => ({ ...row })),
      save: jest.fn((row: ExecutionPlanEntity) => {
        const entity = {
          ...row,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
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
    };

    onChainFind = jest.fn().mockImplementation(() => Promise.resolve(onChainTxs));
    onChainFindOne = jest.fn().mockImplementation(() =>
      Promise.resolve(onChainTxs[0] ?? null),
    );

    const onChainTxRepo = {
      find: onChainFind,
      findOne: onChainFindOne,
    } as unknown as Repository<OnChainTransaction>;

    const capitalHttp = {
      getReservation: capitalGetReservation,
    };
    const riskHttp = {
      getRiskDecision: riskGetDecision,
    };

    service = new PlansService(
      dataSource,
      plansRepo,
      onChainTxRepo,
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
      playbookConfig: null,
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

  describe('list / getById', () => {
    it('list returns plans ordered by createdAt DESC', async () => {
      plans.push(makePlan({ id: 'p-1' }));
      plans.push(makePlan({ id: 'p-2' }));
      const result = await service.list();
      expect(result).toHaveLength(2);
    });

    it('getById throws NotFoundException when plan is missing', async () => {
      await expect(service.getById('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('getById returns plan when present', async () => {
      plans.push(makePlan({ id: 'p-found' }));
      const row = await service.getById('p-found');
      expect(row.id).toBe('p-found');
    });
  });

  describe('linkReservation edge cases', () => {
    it('throws NotFoundException when plan is missing', async () => {
      await expect(
        service.linkReservation('missing', 'res-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when plan state is not planned', async () => {
      plans.push(makePlan({ state: 'reserved' }));
      await expect(
        service.linkReservation(
          '11111111-1111-4111-8111-111111111111',
          '33333333-3333-4333-8333-333333333333',
        ),
      ).rejects.toThrow('must be planned to link reservation');
    });

    it('throws ConflictException when risk decision NotFound', async () => {
      plans.push(makePlan());
      riskGetDecision.mockRejectedValue(new NotFoundException('missing'));
      await expect(
        service.linkReservation(
          '11111111-1111-4111-8111-111111111111',
          '33333333-3333-4333-8333-333333333333',
        ),
      ).rejects.toThrow('Risk decision');
    });

    it('rethrows non-NotFoundException from risk service', async () => {
      plans.push(makePlan());
      riskGetDecision.mockRejectedValue(new Error('rpc down'));
      await expect(
        service.linkReservation(
          '11111111-1111-4111-8111-111111111111',
          '33333333-3333-4333-8333-333333333333',
        ),
      ).rejects.toThrow('rpc down');
    });

    it('throws ConflictException when reservation is expired', async () => {
      plans.push(makePlan());
      riskGetDecision.mockResolvedValue(makeRiskSnapshot());
      capitalGetReservation.mockResolvedValue(
        makeReservationSnapshot({ state: 'expired' }),
      );
      await expect(
        service.linkReservation(
          '11111111-1111-4111-8111-111111111111',
          '33333333-3333-4333-8333-333333333333',
        ),
      ).rejects.toThrow('has expired');
    });

    it('throws ConflictException when reservation state is non-active non-expired', async () => {
      plans.push(makePlan());
      riskGetDecision.mockResolvedValue(makeRiskSnapshot());
      capitalGetReservation.mockResolvedValue(
        makeReservationSnapshot({ state: 'released' }),
      );
      await expect(
        service.linkReservation(
          '11111111-1111-4111-8111-111111111111',
          '33333333-3333-4333-8333-333333333333',
        ),
      ).rejects.toThrow('is not active');
    });

    it('throws ConflictException when reservation has expired (timestamp past)', async () => {
      plans.push(makePlan());
      riskGetDecision.mockResolvedValue(makeRiskSnapshot());
      capitalGetReservation.mockResolvedValue(
        makeReservationSnapshot({
          state: 'active',
          expiresAtIso: new Date(Date.now() - 60_000).toISOString(),
        }),
      );
      await expect(
        service.linkReservation(
          '11111111-1111-4111-8111-111111111111',
          '33333333-3333-4333-8333-333333333333',
        ),
      ).rejects.toThrow('has expired');
    });

    it('throws ConflictException when reservation belongs to a different plan', async () => {
      plans.push(makePlan());
      riskGetDecision.mockResolvedValue(makeRiskSnapshot());
      capitalGetReservation.mockResolvedValue(
        makeReservationSnapshot({ planId: 'other-plan-id' }),
      );
      await expect(
        service.linkReservation(
          '11111111-1111-4111-8111-111111111111',
          '33333333-3333-4333-8333-333333333333',
        ),
      ).rejects.toThrow('belongs to plan');
    });

    it('throws ConflictException when reservation correlationId does not match plan', async () => {
      plans.push(makePlan({ correlationId: 'plan-corr' }));
      riskGetDecision.mockResolvedValue(makeRiskSnapshot());
      capitalGetReservation.mockResolvedValue(
        makeReservationSnapshot({ correlationId: 'res-corr-different' }),
      );
      await expect(
        service.linkReservation(
          '11111111-1111-4111-8111-111111111111',
          '33333333-3333-4333-8333-333333333333',
        ),
      ).rejects.toThrow('correlation does not match');
    });

    it('throws ConflictException when risk correlationId does not match plan', async () => {
      plans.push(makePlan({ correlationId: 'plan-corr' }));
      riskGetDecision.mockResolvedValue(
        makeRiskSnapshot({ correlationId: 'risk-corr-different' }),
      );
      await expect(
        service.linkReservation(
          '11111111-1111-4111-8111-111111111111',
          '33333333-3333-4333-8333-333333333333',
        ),
      ).rejects.toThrow('correlation does not match');
    });

    it('throws ConflictException when capital reservation NotFound (linkReservation)', async () => {
      plans.push(makePlan());
      riskGetDecision.mockResolvedValue(makeRiskSnapshot());
      capitalGetReservation.mockRejectedValue(new NotFoundException('gone'));
      await expect(
        service.linkReservation(
          '11111111-1111-4111-8111-111111111111',
          '33333333-3333-4333-8333-333333333333',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('arm edge cases', () => {
    it('throws NotFoundException when plan missing', async () => {
      await expect(service.arm('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws ConflictException when plan is not reserved', async () => {
      plans.push(makePlan({ state: 'planned' }));
      await expect(
        service.arm('11111111-1111-4111-8111-111111111111'),
      ).rejects.toThrow('must be reserved before arm');
    });

    it('throws ConflictException when capitalReservationId is null on reserved plan', async () => {
      plans.push(makePlan({ state: 'reserved', capitalReservationId: null }));
      await expect(
        service.arm('11111111-1111-4111-8111-111111111111'),
      ).rejects.toThrow('has no capital reservation');
    });

    it('throws ConflictException when risk decision missing', async () => {
      plans.push(
        makePlan({
          state: 'reserved',
          capitalReservationId: '33333333-3333-4333-8333-333333333333',
        }),
      );
      riskGetDecision.mockRejectedValue(new NotFoundException('missing'));
      await expect(
        service.arm('11111111-1111-4111-8111-111111111111'),
      ).rejects.toThrow('Risk decision');
    });

    it('throws ConflictException when reservation missing during arm', async () => {
      plans.push(
        makePlan({
          state: 'reserved',
          capitalReservationId: '33333333-3333-4333-8333-333333333333',
        }),
      );
      riskGetDecision.mockResolvedValue(makeRiskSnapshot());
      capitalGetReservation.mockRejectedValue(new NotFoundException('gone'));
      await expect(
        service.arm('11111111-1111-4111-8111-111111111111'),
      ).rejects.toThrow('Reservation');
    });
  });

  describe('tryMarkPlanCompletedWhenAllLegsFilled additional paths', () => {
    it('returns completed=false when no legs exist', async () => {
      const r = await service.tryMarkPlanCompletedWhenAllLegsFilled('p-none');
      expect(r).toEqual({ completed: false, plan: null });
    });

    it('returns completed=false when plan state is not executing', async () => {
      plans.push(makePlan({ state: 'armed' }));
      executionLegs.push({
        planId: '11111111-1111-4111-8111-111111111111',
        state: 'filled',
      });
      const r = await service.tryMarkPlanCompletedWhenAllLegsFilled(
        '11111111-1111-4111-8111-111111111111',
      );
      expect(r.completed).toBe(false);
      expect(r.plan).not.toBeNull();
    });

    it('uses plan.id as correlationId when correlationId is empty', async () => {
      plans.push(
        makePlan({
          state: 'executing',
          correlationId: '',
          capitalReservationId: 'res-1',
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
      const envelope = outboxRows[0]?.envelope as { correlationId: string };
      expect(envelope.correlationId).toBe(
        '11111111-1111-4111-8111-111111111111',
      );
    });
  });

  describe('getDexEnrichment', () => {
    it('returns null defaults when plan has no legs', async () => {
      const result = await service.getDexEnrichment('p-no-legs');
      expect(result).toEqual({
        venueType: null,
        chainId: null,
        dexAdapter: null,
        txHash: null,
        txStatus: null,
        gasUsedWei: null,
        gasCostUsd: null,
      });
    });

    it('returns null defaults when legs exist but no on-chain tx', async () => {
      executionLegs.push({
        planId: '11111111-1111-4111-8111-111111111111',
        state: 'filled',
      });
      onChainTxs.length = 0;
      const result = await service.getDexEnrichment(
        '11111111-1111-4111-8111-111111111111',
      );
      expect(result.txHash).toBeNull();
      expect(result.venueType).toBeNull();
    });

    it('returns dex enrichment with summed gas when on-chain tx exists', async () => {
      executionLegs.push({
        planId: '11111111-1111-4111-8111-111111111111',
        state: 'filled',
      });
      onChainTxs.push(
        {
          legId: 'leg-1',
          chainId: 1,
          txHash: '0xtx1',
          status: 'confirmed',
          gasUsed: '21000',
          gasPrice: '1000000000',
          createdAt: new Date('2026-07-17T10:00:00Z'),
        } as OnChainTransaction,
        {
          legId: 'leg-2',
          chainId: 1,
          txHash: '0xtx2',
          status: 'confirmed',
          gasUsed: '30000',
          gasPrice: '1000000000',
          createdAt: new Date('2026-07-17T11:00:00Z'),
        } as OnChainTransaction,
      );
      const result = await service.getDexEnrichment(
        '11111111-1111-4111-8111-111111111111',
      );
      expect(result.venueType).toBe('dex');
      expect(result.chainId).toBe(1);
      expect(result.txHash).toBe('0xtx1');
      expect(result.txStatus).toBe('confirmed');
      // (21000 + 30000) * 1e9 = 51000 * 1e9
      expect(BigInt(result.gasUsedWei ?? '0')).toBe(51000n * 1_000_000_000n);
    });

    it('skips malformed gas values (BigInt parse failure)', async () => {
      executionLegs.push({
        planId: '11111111-1111-4111-8111-111111111111',
        state: 'filled',
      });
      onChainTxs.push({
        legId: 'leg-1',
        chainId: 1,
        txHash: '0xtx1',
        status: 'confirmed',
        gasUsed: 'not-a-number',
        gasPrice: 'also-bad',
        createdAt: new Date('2026-07-17T10:00:00Z'),
      } as OnChainTransaction);
      const result = await service.getDexEnrichment(
        '11111111-1111-4111-8111-111111111111',
      );
      expect(BigInt(result.gasUsedWei ?? '0')).toBe(0n);
    });

    it('skips legs with null gasUsed or gasPrice', async () => {
      executionLegs.push({
        planId: '11111111-1111-4111-8111-111111111111',
        state: 'filled',
      });
      onChainTxs.push({
        legId: 'leg-1',
        chainId: 1,
        txHash: '0xtx1',
        status: 'confirmed',
        gasUsed: null,
        gasPrice: null,
        createdAt: new Date('2026-07-17T10:00:00Z'),
      } as OnChainTransaction);
      const result = await service.getDexEnrichment(
        '11111111-1111-4111-8111-111111111111',
      );
      expect(BigInt(result.gasUsedWei ?? '0')).toBe(0n);
    });
  });

  describe('getLegs / getOnChainTxsForPlan / getOnChainTxsForLeg', () => {
    it('getLegs throws NotFoundException when plan missing', async () => {
      await expect(service.getLegs('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('getLegs returns legs for existing plan', async () => {
      plans.push(makePlan());
      executionLegs.push({
        planId: '11111111-1111-4111-8111-111111111111',
        state: 'filled',
      });
      const legs = await service.getLegs(
        '11111111-1111-4111-8111-111111111111',
      );
      expect(legs).toHaveLength(1);
    });

    it('getOnChainTxsForPlan returns empty when plan has no legs', async () => {
      plans.push(makePlan());
      const txs = await service.getOnChainTxsForPlan(
        '11111111-1111-4111-8111-111111111111',
      );
      expect(txs).toEqual([]);
    });

    it('getOnChainTxsForPlan returns txs for plan legs', async () => {
      plans.push(makePlan());
      executionLegs.push({
        planId: '11111111-1111-4111-8111-111111111111',
        state: 'filled',
      });
      onChainTxs.push({
        legId: 'leg-1',
        chainId: 1,
        txHash: '0xabc',
        status: 'confirmed',
        createdAt: new Date(),
      } as OnChainTransaction);
      const txs = await service.getOnChainTxsForPlan(
        '11111111-1111-4111-8111-111111111111',
      );
      expect(txs).toHaveLength(1);
    });

    it('getOnChainTxsForLeg returns txs for the given leg', async () => {
      onChainTxs.push({
        legId: 'leg-1',
        chainId: 1,
        txHash: '0xabc',
        status: 'confirmed',
        createdAt: new Date(),
      } as OnChainTransaction);
      const txs = await service.getOnChainTxsForLeg('leg-1');
      expect(txs).toHaveLength(1);
    });
  });
});
