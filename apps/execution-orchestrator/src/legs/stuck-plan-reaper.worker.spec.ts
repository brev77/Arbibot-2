import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import type { DataSource, Repository } from 'typeorm';
import type { ExecutionLegEntity, ExecutionPlanEntity } from '@arbibot/persistence';

import { StuckPlanReaperWorker } from './stuck-plan-reaper.worker';
import type { PlansService } from '../plans/plans.service';

describe('StuckPlanReaperWorker (P9-7)', () => {
  function buildWorker(opts: {
    stuckLegs?: Partial<ExecutionLegEntity>[];
    confirmedTxForLeg?: (legId: string) => unknown[];
    stuckPlans?: Partial<ExecutionPlanEntity>[];
    /** For PLAN14 auto-fail on-chain re-check: legs found for a plan (planHasPendingOnChainTx). */
    planSubmittingLegs?: Partial<ExecutionLegEntity>[];
    /** For PLAN14 auto-fail on-chain re-check: on-chain tx rows for those legs. */
    planTxRows?: unknown[];
    markFailedResult?: { failed: boolean; plan: ExecutionPlanEntity | null };
  }) {
    const legs = opts.stuckLegs ?? [];
    const plans = opts.stuckPlans ?? [];
    // legsRepo.find is called twice: (1) reaper leg-scan (returns `legs`), (2) PLAN14
    // planHasPendingOnChainTx (returns `planSubmittingLegs`). Distinguish by the `where`
    // argument — the plan check filters `state: 'submitting'` AND `planId`.
    let findCallIdx = 0;
    const legsRepo = {
      find: jest.fn((args?: { where?: { planId?: string } }) => {
        // PLAN14 planHasPendingOnChainTx passes a `where.planId` filter.
        if (args?.where?.planId !== undefined) {
          return Promise.resolve(opts.planSubmittingLegs ?? []);
        }
        // Leg-scan path — preserve original behaviour (returns stuckLegs).
        void findCallIdx++;
        return Promise.resolve(legs);
      }),
    } as unknown as Repository<ExecutionLegEntity>;
    const txFn = jest.fn(async (fn: (em: unknown) => Promise<unknown>) => {
      const em = {
        findOne: jest.fn(() => Promise.resolve(legs[0] ?? null)),
        save: jest.fn((e: ExecutionLegEntity) => Promise.resolve(e)),
        query: jest.fn((_sql: string, params: unknown[]) => {
          const p0 = params[0];
          // reapStuckLeg passes a single legId string; planHasPendingOnChainTx passes an array.
          if (Array.isArray(p0)) {
            return Promise.resolve(opts.planTxRows ?? []);
          }
          const legId = p0 as string;
          return Promise.resolve(opts.confirmedTxForLeg ? opts.confirmedTxForLeg(legId) : []);
        }),
      };
      return fn(em);
    });
    const planRepo = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn(() => Promise.resolve(plans)),
      })),
    };
    const getRepo = jest.fn(() => planRepo);
    const dataSource = {
      transaction: txFn,
      getRepository: getRepo,
      query: jest.fn((_sql: string, params: unknown[]) => {
        // planHasPendingOnChainTx uses dataSource.query (not the em.query inside a tx).
        const p0 = params[0];
        if (Array.isArray(p0)) {
          return Promise.resolve(opts.planTxRows ?? []);
        }
        return Promise.resolve([]);
      }),
    } as unknown as DataSource;
    const markFailed = jest.fn(() =>
      Promise.resolve(
        opts.markFailedResult ?? { failed: true, plan: { id: 'plan-x' } as ExecutionPlanEntity },
      ),
    );
    const plansService = { markFailed } as unknown as PlansService;
    const worker = new StuckPlanReaperWorker(dataSource, legsRepo, plansService);
    return { worker, legsRepo, txFn, markFailed };
  }

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
    delete process.env.STUCK_REAPER_AUTO_FAIL_PLANS;
  });

  it('recovers a submitting leg when a confirmed on-chain tx exists (Phase 3 partial commit)', async () => {
    const oldLeg = {
      id: 'leg-1',
      state: 'submitting',
      updatedAt: new Date(Date.now() - 600_000),
      entityVersion: 2,
      venueRef: null,
    } as Partial<ExecutionLegEntity>;
    const { worker } = buildWorker({
      stuckLegs: [oldLeg],
      confirmedTxForLeg: () => [{ tx_hash: '0xconfirmed' }],
    });
    const result = await worker.runCycle();
    expect(result.legsRecovered).toBe(1);
    expect(result.legsFailed).toBe(0);
  });

  it('marks a submitting leg failed when no confirmed on-chain tx exists (crash before Phase 3)', async () => {
    const oldLeg = {
      id: 'leg-2',
      state: 'submitting',
      updatedAt: new Date(Date.now() - 600_000),
      entityVersion: 2,
      venueRef: null,
    } as Partial<ExecutionLegEntity>;
    const { worker } = buildWorker({
      stuckLegs: [oldLeg],
      confirmedTxForLeg: () => [],
    });
    const result = await worker.runCycle();
    expect(result.legsFailed).toBe(1);
    expect(result.legsRecovered).toBe(0);
  });

  it('skips legs that are not old enough (within LEG_STUCK_TIMEOUT_MS)', async () => {
    const youngLeg = {
      id: 'leg-3',
      state: 'submitting',
      updatedAt: new Date(), // just now
      entityVersion: 2,
      venueRef: null,
    } as Partial<ExecutionLegEntity>;
    const { worker } = buildWorker({
      stuckLegs: [youngLeg],
      confirmedTxForLeg: () => [{ tx_hash: '0x' }],
    });
    const result = await worker.runCycle();
    expect(result.legsRecovered).toBe(0);
    expect(result.legsFailed).toBe(0);
  });

  it('surfaces stuck plans count (alert-only when STUCK_REAPER_AUTO_FAIL_PLANS is off)', async () => {
    // Default OFF — alert + log only, no markFailed call.
    const { worker, markFailed } = buildWorker({
      stuckPlans: [
        { id: 'plan-a', state: 'executing', updatedAt: new Date(Date.now() - 6_000_000) },
        { id: 'plan-b', state: 'executing', updatedAt: new Date(Date.now() - 6_000_000) },
      ],
    });
    const result = await worker.runCycle();
    expect(result.plansStuck).toBe(2);
    expect(result.plansAutoFailed).toBe(0);
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('PLAN14: auto-fails stuck plans when STUCK_REAPER_AUTO_FAIL_PLANS=true and no pending on-chain tx', async () => {
    process.env.STUCK_REAPER_AUTO_FAIL_PLANS = 'true';
    const { worker, markFailed } = buildWorker({
      stuckPlans: [
        { id: 'plan-a', state: 'executing', updatedAt: new Date(Date.now() - 6_000_000) },
      ],
      // planHasPendingOnChainTx: no submitting legs → no pending tx → eligible for fail.
      planSubmittingLegs: [],
      planTxRows: [],
    });
    const result = await worker.runCycle();
    expect(result.plansAutoFailed).toBe(1);
    expect(markFailed).toHaveBeenCalledWith('plan-a', 'stuck_reaper');
  });

  it('PLAN14: skips auto-fail when the plan has a submitting leg with a pending on-chain tx', async () => {
    process.env.STUCK_REAPER_AUTO_FAIL_PLANS = 'true';
    const { worker, markFailed } = buildWorker({
      stuckPlans: [
        { id: 'plan-broadcast', state: 'executing', updatedAt: new Date(Date.now() - 6_000_000) },
      ],
      // planHasPendingOnChainTx: a submitting leg exists AND has an on-chain tx row.
      planSubmittingLegs: [{ id: 'leg-x', state: 'submitting' }],
      planTxRows: [{ id: 1, tx_hash: '0xpending' }],
    });
    const result = await worker.runCycle();
    expect(result.plansAutoFailed).toBe(0);
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('returns zeros when there is nothing stuck', async () => {
    const { worker } = buildWorker({});
    const result = await worker.runCycle();
    expect(result).toEqual({
      legsRecovered: 0,
      legsFailed: 0,
      plansStuck: 0,
      plansAutoFailed: 0,
    });
  });
});
