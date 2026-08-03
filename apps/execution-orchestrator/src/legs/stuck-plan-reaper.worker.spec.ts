import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import type { DataSource, Repository } from 'typeorm';
import type { ExecutionLegEntity } from '@arbibot/persistence';

import { StuckPlanReaperWorker } from './stuck-plan-reaper.worker';

describe('StuckPlanReaperWorker (P9-7)', () => {
  function buildWorker(opts: {
    stuckLegs?: Partial<ExecutionLegEntity>[];
    confirmedTxForLeg?: (legId: string) => unknown[];
    planCount?: number;
  }) {
    const legs = opts.stuckLegs ?? [];
    const legsRepo = {
      find: jest.fn(() => Promise.resolve(legs)),
    } as unknown as Repository<ExecutionLegEntity>;
    const txFn = jest.fn(async (fn: (em: unknown) => Promise<unknown>) => {
      const em = {
        findOne: jest.fn(() => Promise.resolve(legs[0] ?? null)),
        save: jest.fn((e: ExecutionLegEntity) => Promise.resolve(e)),
        query: jest.fn((_sql: string, params: unknown[]) => {
          const legId = params[0] as string;
          return Promise.resolve(opts.confirmedTxForLeg ? opts.confirmedTxForLeg(legId) : []);
        }),
      };
      return fn(em);
    });
    const planRepo = {
      getCount: jest.fn(() => Promise.resolve(opts.planCount ?? 0)),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn(() => Promise.resolve(opts.planCount ?? 0)),
      })),
    };
    const getRepo = jest.fn(() => planRepo);
    const dataSource = {
      transaction: txFn,
      getRepository: getRepo,
    } as unknown as DataSource;
    const worker = new StuckPlanReaperWorker(dataSource, legsRepo);
    return { worker, legsRepo, txFn };
  }

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
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

  it('surfaces stuck plans count (alert-only, no transition)', async () => {
    const { worker } = buildWorker({ planCount: 2 });
    const result = await worker.runCycle();
    expect(result.plansStuck).toBe(2);
  });

  it('returns zeros when there is nothing stuck', async () => {
    const { worker } = buildWorker({});
    const result = await worker.runCycle();
    expect(result).toEqual({ legsRecovered: 0, legsFailed: 0, plansStuck: 0 });
  });
});
