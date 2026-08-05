import { ConflictException } from '@nestjs/common';
import { getRepository } from 'typeorm';

import { ExecutionLegEntity, ExecutionPlanEntity } from '@arbibot/persistence';

import { LegAutoDriverWorker } from './leg-auto-driver.worker';

/**
 * PLAN10 P10-EO — LegAutoDriverWorker spec.
 *
 * Covers the right Germans-feedback corrections:
 *   Р2-1: state check after markSent (submitting → skip, sent → continue)
 *   Р2-3: sequential leg processing (buy → fill → sell)
 *   Р2-4: live-only filter (paper-dex excluded)
 *   Р2-5: reverted-sell → fill_failed → manual (logged)
 * Plus: kill-switch halt, markSent transient (503 → skip), reentrancy.
 *
 * LegsService + PlansService + DexKillSwitchService are mocked; the worker calls their
 * public methods. We drive runCycle indirectly by calling the private drivePendingLegs.
 */

const ENV_KEYS = ['LEG_AUTO_DRIVE_ENABLED', 'LEG_AUTO_DRIVE_INTERVAL_MS', 'NODE_ENV'] as const;

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

function makeLeg(overrides: Partial<ExecutionLegEntity> = {}): ExecutionLegEntity {
  return {
    id: 'leg-1',
    planId: 'plan-1',
    legIndex: 0,
    state: 'created',
    entityVersion: 1,
    venueRef: null,
    legType: 'dex',
    chainId: 42161,
    targetQuantity: 1,
    filledQuantity: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ExecutionLegEntity;
}

describe('LegAutoDriverWorker', () => {
  let worker: LegAutoDriverWorker;
  const legsMock: { markSent: jest.Mock; markAcknowledged: jest.Mock; applyFill: jest.Mock } = {
    markSent: jest.fn(),
    markAcknowledged: jest.fn(),
    applyFill: jest.fn(),
  };
  const plansMock: { tryMarkPlanCompletedWhenAllLegsFilled: jest.Mock } = {
    tryMarkPlanCompletedWhenAllLegsFilled: jest.fn(),
  };
  const killSwitchMock: { assertLiveNotHalted: jest.Mock; isLiveHalted: jest.Mock } = {
    assertLiveNotHalted: jest.fn(),
    isLiveHalted: jest.fn(),
  };
  const legsRepoMock = { find: jest.fn(), findOne: jest.fn() };
  const plansRepoMock = { findOne: jest.fn() };

  beforeEach(() => {
    clearEnv();
    process.env.LEG_AUTO_DRIVE_ENABLED = 'true';
    jest.clearAllMocks();
    // Clear metrics registry BEFORE creating the worker (it registers Counters/Histograms
    // in field initializers; without clearing, re-instantiation throws double-registration).
    getArbibotMetricsRegistrySafe();
    killSwitchMock.assertLiveNotHalted.mockResolvedValue(undefined);
    killSwitchMock.isLiveHalted.mockResolvedValue(false);
    worker = new LegAutoDriverWorker(
      legsMock as unknown as never,
      plansMock as unknown as never,
      killSwitchMock as unknown as never,
      legsRepoMock as unknown as ReturnType<typeof getRepository<ExecutionLegEntity>>,
      plansRepoMock as unknown as ReturnType<typeof getRepository<ExecutionPlanEntity>>,
    );
  });

  afterEach(() => {
    clearEnv();
  });

  describe('enabled / disabled', () => {
    it('disabled when LEG_AUTO_DRIVE_ENABLED unset', () => {
      delete process.env.LEG_AUTO_DRIVE_ENABLED;
      getArbibotMetricsRegistrySafe();
      const w = new LegAutoDriverWorker(
        legsMock as unknown as never,
        plansMock as unknown as never,
        killSwitchMock as unknown as never,
        legsRepoMock as unknown as never,
        plansRepoMock as unknown as never,
      );
      expect((w as unknown as { isEnabled: () => boolean }).isEnabled()).toBe(false);
    });
  });

  describe('drivePendingLegs — Р2-1 state check', () => {
    it('skips leg if markSent leaves it in submitting (Р2-1)', async () => {
      legsRepoMock.find.mockResolvedValue([makeLeg({ id: 'leg-1', legIndex: 0 })]);
      plansRepoMock.findOne.mockResolvedValue({
        id: 'plan-1',
        state: 'executing',
        playbookConfig: { legs: [{ venueKey: 'uniswap-v2' }] },
      });
      legsMock.markSent.mockResolvedValue({ id: 'leg-1', state: 'sent' });
      // After markSent, re-read returns submitting (tx pending).
      legsRepoMock.findOne.mockResolvedValue({ id: 'leg-1', state: 'submitting' });

      await (worker as unknown as { drivePendingLegs: () => Promise<void> }).drivePendingLegs();

      expect(legsMock.markSent).toHaveBeenCalledWith('plan-1', 'leg-1');
      // Р2-1: markAcknowledged NOT called because state is submitting.
      expect(legsMock.markAcknowledged).not.toHaveBeenCalled();
      expect(legsMock.applyFill).not.toHaveBeenCalled();
    });

    it('continues to ack+fill when markSent leaves leg in sent', async () => {
      legsRepoMock.find.mockResolvedValue([makeLeg({ id: 'leg-1', legIndex: 0 })]);
      plansRepoMock.findOne.mockResolvedValue({
        id: 'plan-1',
        state: 'executing',
        playbookConfig: { legs: [{ venueKey: 'uniswap-v2' }] },
      });
      legsMock.markSent.mockResolvedValue({ id: 'leg-1', state: 'sent' });
      legsRepoMock.findOne.mockResolvedValue({ id: 'leg-1', state: 'sent' });
      legsMock.markAcknowledged.mockResolvedValue({});
      legsMock.applyFill.mockResolvedValue({ id: 'leg-1', state: 'filled' });

      await (worker as unknown as { drivePendingLegs: () => Promise<void> }).drivePendingLegs();

      expect(legsMock.markAcknowledged).toHaveBeenCalledWith('plan-1', 'leg-1');
      expect(legsMock.applyFill).toHaveBeenCalledWith('plan-1', 'leg-1', expect.objectContaining({ mode: 'full' }));
    });
  });

  describe('drivePendingLegs — Р2-4 live-only filter', () => {
    it('skips paper-dex venue legs (Р2-4)', async () => {
      legsRepoMock.find.mockResolvedValue([makeLeg({ id: 'leg-paper', legIndex: 0 })]);
      plansRepoMock.findOne.mockResolvedValue({
        id: 'plan-1',
        state: 'executing',
        playbookConfig: { legs: [{ venueKey: 'paper-dex' }] },
      });

      await (worker as unknown as { drivePendingLegs: () => Promise<void> }).drivePendingLegs();

      expect(legsMock.markSent).not.toHaveBeenCalled();
    });
  });

  describe('drivePendingLegs — Р2-3 sequential', () => {
    it('processes legs in legIndex order (buy then sell)', async () => {
      const sellLeg = makeLeg({ id: 'leg-sell', legIndex: 1 });
      const buyLeg = makeLeg({ id: 'leg-buy', legIndex: 0 });
      legsRepoMock.find.mockResolvedValue([sellLeg, buyLeg]); // unsorted
      plansRepoMock.findOne.mockResolvedValue({
        id: 'plan-1',
        state: 'executing',
        playbookConfig: { legs: [{ venueKey: 'uniswap-v2' }, { venueKey: 'sushiswap' }] },
      });
      legsMock.markSent.mockResolvedValue({ state: 'sent' });
      legsRepoMock.findOne.mockResolvedValue({ state: 'sent' });
      legsMock.markAcknowledged.mockResolvedValue({});
      legsMock.applyFill.mockResolvedValue({ state: 'filled' });

      const order: string[] = [];
      legsMock.markSent.mockImplementation((planId: string, legId: string) => {
        order.push(legId);
        return Promise.resolve({ state: 'sent' });
      });

      await (worker as unknown as { drivePendingLegs: () => Promise<void> }).drivePendingLegs();

      expect(order).toEqual(['leg-buy', 'leg-sell']); // Р2-3 sequential by legIndex
    });
  });

  describe('drivePendingLegs — Р2-5 reverted sell (terminal failure)', () => {
    it('logs fill_failed when applyFill throws (sell revert path)', async () => {
      legsRepoMock.find.mockResolvedValue([makeLeg({ id: 'leg-1' })]);
      plansRepoMock.findOne.mockResolvedValue({
        id: 'plan-1',
        state: 'executing',
        playbookConfig: { legs: [{ venueKey: 'uniswap-v2' }] },
      });
      legsMock.markSent.mockResolvedValue({ state: 'sent' });
      legsRepoMock.findOne.mockResolvedValue({ state: 'sent' });
      legsMock.markAcknowledged.mockResolvedValue({});
      legsMock.applyFill.mockRejectedValue(new Error('sell reverted: insufficient balance'));

      await (worker as unknown as { drivePendingLegs: () => Promise<void> }).drivePendingLegs();

      // Р2-5: terminal failure logged; plan stays incomplete → manual recovery.
      expect(legsMock.applyFill).toHaveBeenCalled();
    });
  });

  describe('kill-switch', () => {
    it('halts cycle when assertLiveNotHalted throws ConflictException', async () => {
      killSwitchMock.assertLiveNotHalted.mockRejectedValue(new ConflictException('halted'));
      legsRepoMock.find.mockResolvedValue([makeLeg()]);

      await (worker as unknown as { runCycle: () => Promise<void> }).runCycle();

      // Should not have driven any legs.
      expect(legsMock.markSent).not.toHaveBeenCalled();
    });
  });

  describe('markSent transient (503)', () => {
    it('skips leg on 503 (transient — reaper reconciles)', async () => {
      legsRepoMock.find.mockResolvedValue([makeLeg({ id: 'leg-1' })]);
      plansRepoMock.findOne.mockResolvedValue({
        id: 'plan-1',
        state: 'executing',
        playbookConfig: { legs: [{ venueKey: 'uniswap-v2' }] },
      });
      legsMock.markSent.mockRejectedValue(Object.assign(new Error('transient'), { status: 503 }));

      await (worker as unknown as { drivePendingLegs: () => Promise<void> }).drivePendingLegs();

      // markSent threw → no ack/fill; leg stays created/submitting for reaper.
      expect(legsMock.markAcknowledged).not.toHaveBeenCalled();
    });
  });

  describe('markSent hang (P9-3 follow-up)', () => {
    it('records mark_sent_timeout and continues to the next leg when markSent hangs', async () => {
      // Bound the timeout via env so the test stays fast (default 90s would stall
      // the suite). markSentTimeoutMs() re-reads env per call → no module reload.
      process.env.MARK_SENT_TIMEOUT_MS = '50';

      legsRepoMock.find.mockResolvedValue([
        makeLeg({ id: 'leg-1', legIndex: 0 }),
        makeLeg({ id: 'leg-2', legIndex: 1 }),
      ]);
      plansRepoMock.findOne.mockResolvedValue({
        id: 'plan-1',
        state: 'executing',
        playbookConfig: { legs: [{ venueKey: 'uniswap-v2' }, { venueKey: 'sushiswap' }] },
      });

      // leg-1's markSent hangs forever (never resolves) — simulates a stuck
      // broadcast holding the worker. leg-2's markSent resolves normally.
      legsMock.markSent.mockImplementation((planId: string, legId: string) => {
        if (legId === 'leg-1') {
          return new Promise(() => undefined); // hangs forever
        }
        return Promise.resolve({ id: legId, state: 'sent' });
      });
      // leg-2 reaches the post-markSent state check → 'sent'.
      legsRepoMock.findOne.mockResolvedValue({ id: 'leg-2', state: 'sent' });
      legsMock.markAcknowledged.mockResolvedValue({});
      legsMock.applyFill.mockResolvedValue({ id: 'leg-2', state: 'filled' });

      const metrics = (worker as unknown as {
        metrics: { legsProcessed: { inc: (labels: { outcome: string }) => void } };
      }).metrics;
      const incSpy = jest.spyOn(metrics.legsProcessed, 'inc');

      await (worker as unknown as { drivePendingLegs: () => Promise<void> }).drivePendingLegs();

      // leg-1 timed out (mark_sent_timeout metric) and the worker continued to leg-2.
      expect(incSpy).toHaveBeenCalledWith({ outcome: 'mark_sent_timeout' });
      // leg-2's markSent WAS called (worker did not abort the whole plan).
      expect(legsMock.markSent).toHaveBeenCalledWith('plan-1', 'leg-2');
      // leg-2 proceeded to ack + fill.
      expect(legsMock.markAcknowledged).toHaveBeenCalledWith('plan-1', 'leg-2');
      expect(legsMock.applyFill).toHaveBeenCalled();
    });

    it('uses default 90s when MARK_SENT_TIMEOUT_MS is unset/invalid', () => {
      delete process.env.MARK_SENT_TIMEOUT_MS;
      getArbibotMetricsRegistrySafe(); // clear registry to avoid double-registration
      const w = new LegAutoDriverWorker(
        legsMock as unknown as never,
        plansMock as unknown as never,
        killSwitchMock as unknown as never,
        legsRepoMock as unknown as never,
        plansRepoMock as unknown as never,
      );
      expect((w as unknown as { markSentTimeoutMs: () => number }).markSentTimeoutMs()).toBe(90_000);

      process.env.MARK_SENT_TIMEOUT_MS = 'not-a-number';
      expect((w as unknown as { markSentTimeoutMs: () => number }).markSentTimeoutMs()).toBe(90_000);
    });
  });
});

// Avoid prom-client double-registration across specs by clearing the registry between suites.
function getArbibotMetricsRegistrySafe(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@arbibot/nest-platform');
    if (typeof mod.getArbibotMetricsRegistry === 'function') {
      mod.getArbibotMetricsRegistry().clear();
    }
  } catch {
    /* ignore */
  }
}
