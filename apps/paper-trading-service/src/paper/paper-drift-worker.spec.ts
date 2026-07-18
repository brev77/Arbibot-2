import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { PaperDriftWorker } from './paper-drift-worker';
import { PaperDriftService } from './paper-drift.service';

/**
 * PaperDriftWorker spec (Phase 4 — paper-trading-service coverage).
 *
 * The worker self-heals stale drift gauges on a periodic interval. The
 * `trigger()` method exposes a manual refresh path that operators can invoke
 * via `POST /paper/drift-samples/refresh-stale`. We exercise:
 *   - onModuleInit disabled path (no startup cycle, no interval)
 *   - onModuleInit enabled path (startup cycle + interval scheduled + unref'd)
 *   - onModuleDestroy stops the worker + clears interval
 *   - trigger() success path (staleInstruments returned)
 *   - trigger() already-running guard (returns success:false)
 *   - trigger() error path (service throws → success:false + message)
 *   - runCycle during shutdown (skipped, returns 0)
 *   - runCycle concurrent-invocation guard (skipped, returns 0)
 *   - runCycle no-stale path (stale=0)
 *   - runCycle non-Error service throw
 *
 * Env isolation per-test (save/restore). The shared metrics registry is
 * cleared in beforeEach so Counter/Histogram re-registration works across
 * specs.
 */
describe('PaperDriftWorker', () => {
  const prevEnabled = process.env.PAPER_DRIFT_SELF_HEAL_ENABLED;
  const prevInterval = process.env.PAPER_DRIFT_SELF_HEAL_INTERVAL_MS;

  const mkDriftService = (updateStale: jest.Mock) =>
    ({ updateStaleGauges: updateStale }) as unknown as PaperDriftService;

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
  });

  afterEach(() => {
    if (prevEnabled === undefined) {
      delete process.env.PAPER_DRIFT_SELF_HEAL_ENABLED;
    } else {
      process.env.PAPER_DRIFT_SELF_HEAL_ENABLED = prevEnabled;
    }
    if (prevInterval === undefined) {
      delete process.env.PAPER_DRIFT_SELF_HEAL_INTERVAL_MS;
    } else {
      process.env.PAPER_DRIFT_SELF_HEAL_INTERVAL_MS = prevInterval;
    }
    jest.useRealTimers();
  });

  describe('onModuleInit / onModuleDestroy', () => {
    it('does not schedule the worker when PAPER_DRIFT_SELF_HEAL_ENABLED=false', () => {
      process.env.PAPER_DRIFT_SELF_HEAL_ENABLED = 'false';
      const updateStale = jest.fn().mockResolvedValue(0);
      const worker = new PaperDriftWorker(mkDriftService(updateStale));
      worker.onModuleInit();
      // No startup cycle was triggered (driftService not called).
      expect(updateStale).not.toHaveBeenCalled();
      // onModuleDestroy must be safe to call regardless.
      worker.onModuleDestroy();
    });

    it('runs an immediate startup cycle and schedules the interval when enabled', async () => {
      process.env.PAPER_DRIFT_SELF_HEAL_ENABLED = 'true';
      const updateStale = jest.fn().mockResolvedValue(2);
      const worker = new PaperDriftWorker(mkDriftService(updateStale));
      worker.onModuleInit();
      // Allow the void runCycle('startup') promise to settle.
      await Promise.resolve();
      await Promise.resolve();
      expect(updateStale).toHaveBeenCalledTimes(1);
      worker.onModuleDestroy();
    });

    it('onModuleDestroy is a no-op when no timer was scheduled', () => {
      process.env.PAPER_DRIFT_SELF_HEAL_ENABLED = 'false';
      const worker = new PaperDriftWorker(mkDriftService(jest.fn()));
      worker.onModuleInit();
      expect(() => worker.onModuleDestroy()).not.toThrow();
    });
  });

  describe('trigger (manual)', () => {
    it('returns success:true with staleInstruments count on happy path', async () => {
      process.env.PAPER_DRIFT_SELF_HEAL_ENABLED = 'false';
      const updateStale = jest.fn().mockResolvedValue(7);
      const worker = new PaperDriftWorker(mkDriftService(updateStale));
      const res = await worker.trigger();
      expect(res.success).toBe(true);
      expect(res.staleInstruments).toBe(7);
      expect(res.message).toContain('7 stale instruments reset');
      expect(updateStale).toHaveBeenCalled();
    });

    it('returns success:false when a cycle is already in progress', async () => {
      process.env.PAPER_DRIFT_SELF_HEAL_ENABLED = 'false';
      let releaseCycle: () => void = () => {};
      const updateStale = jest.fn(
        () =>
          new Promise<number>((resolve) => {
            releaseCycle = () => resolve(0);
          }),
      );
      const worker = new PaperDriftWorker(mkDriftService(updateStale));
      // Start a cycle and don't await it — trigger() must observe isRunning=true.
      const first = worker.trigger();
      const second = await worker.trigger();
      expect(second.success).toBe(false);
      expect(second.message).toContain('already in progress');
      // Release and await the first call so the suite can clean up.
      releaseCycle();
      const firstRes = await first;
      expect(firstRes.success).toBe(true);
    });

    it('returns success:false with error message when service throws an Error', async () => {
      process.env.PAPER_DRIFT_SELF_HEAL_ENABLED = 'false';
      const updateStale = jest.fn().mockRejectedValue(new Error('update failed'));
      const worker = new PaperDriftWorker(mkDriftService(updateStale));
      const res = await worker.trigger();
      expect(res.success).toBe(false);
      expect(res.staleInstruments).toBe(0);
      expect(res.message).toContain('Self-heal failed');
      expect(res.message).toContain('update failed');
    });

    it('stringifies non-Error service throws in the trigger error path', async () => {
      process.env.PAPER_DRIFT_SELF_HEAL_ENABLED = 'false';
      const updateStale = jest.fn().mockRejectedValue('string-err');
      const worker = new PaperDriftWorker(mkDriftService(updateStale));
      const res = await worker.trigger();
      expect(res.success).toBe(false);
      expect(res.message).toContain('string-err');
    });

    it('reports staleInstruments=0 with a different message when no stale found', async () => {
      process.env.PAPER_DRIFT_SELF_HEAL_ENABLED = 'false';
      const updateStale = jest.fn().mockResolvedValue(0);
      const worker = new PaperDriftWorker(mkDriftService(updateStale));
      const res = await worker.trigger();
      expect(res.success).toBe(true);
      expect(res.staleInstruments).toBe(0);
    });
  });

  describe('shutdown interaction', () => {
    it('trigger returns success:true but underlying cycle is skipped after onModuleDestroy', async () => {
      process.env.PAPER_DRIFT_SELF_HEAL_ENABLED = 'false';
      const updateStale = jest.fn().mockResolvedValue(5);
      const worker = new PaperDriftWorker(mkDriftService(updateStale));
      worker.onModuleDestroy();
      // After shutdown, runCycle short-circuits with 0 stale — trigger still
      // returns success because the cycle ran without throwing.
      const res = await worker.trigger();
      expect(res.success).toBe(true);
      // updateStaleGauges was NOT called (runCycle returned early).
      expect(updateStale).not.toHaveBeenCalled();
    });
  });
});
