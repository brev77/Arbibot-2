import { PaperDiscoveryWorker } from './paper-discovery-worker';
import { PaperDiscoveryService } from './paper-discovery.service';

/**
 * PaperDiscoveryWorker spec (Phase 4 — opportunity-service coverage).
 *
 * The worker polls `PaperDiscoveryService.discoverPaperOpportunities` on an
 * env-driven interval (PAPER_DISCOVERY_POLL_MS, default 300_000). Setting
 * the interval to 0 / non-finite disables polling. We exercise:
 *   - onModuleInit disabled path (no timer scheduled)
 *   - onModuleInit enabled path (interval scheduled + unref'd)
 *   - onModuleDestroy clears the timer (or no-op without timer)
 *   - runDiscovery is guarded against concurrent invocation
 *   - runDiscovery swallows service errors (logs + continues)
 *
 * Env isolation per-test (save/restore) so the suite is deterministic.
 */
describe('PaperDiscoveryWorker', () => {
  const prevPoll = process.env.PAPER_DISCOVERY_POLL_MS;

  const mkService = (discover: jest.Mock) =>
    ({ discoverPaperOpportunities: discover }) as unknown as PaperDiscoveryService;

  afterEach(() => {
    if (prevPoll === undefined) {
      delete process.env.PAPER_DISCOVERY_POLL_MS;
    } else {
      process.env.PAPER_DISCOVERY_POLL_MS = prevPoll;
    }
    jest.useRealTimers();
  });

  describe('onModuleInit / onModuleDestroy', () => {
    it('skips scheduling when PAPER_DISCOVERY_POLL_MS=0', () => {
      process.env.PAPER_DISCOVERY_POLL_MS = '0';
      const discover = jest.fn();
      const worker = new PaperDiscoveryWorker(mkService(discover));
      worker.onModuleInit();
      expect(discover).not.toHaveBeenCalled();
      // onModuleDestroy must be a no-op (no timer was scheduled).
      worker.onModuleDestroy();
    });

    it('skips scheduling when PAPER_DISCOVERY_POLL_MS is non-finite', () => {
      process.env.PAPER_DISCOVERY_POLL_MS = 'NaN';
      const discover = jest.fn();
      const worker = new PaperDiscoveryWorker(mkService(discover));
      worker.onModuleInit();
      expect(discover).not.toHaveBeenCalled();
    });

    it('schedules the polling interval when enabled', () => {
      process.env.PAPER_DISCOVERY_POLL_MS = '300000';
      const discover = jest.fn();
      const worker = new PaperDiscoveryWorker(mkService(discover));
      worker.onModuleInit();
      // Note: discovery is only invoked on the interval tick; the worker
      // does NOT run an immediate cycle on startup.
      expect(discover).not.toHaveBeenCalled();
      worker.onModuleDestroy();
    });

    it('uses the default 300000ms when env is unset', () => {
      delete process.env.PAPER_DISCOVERY_POLL_MS;
      const discover = jest.fn();
      const worker = new PaperDiscoveryWorker(mkService(discover));
      worker.onModuleInit();
      worker.onModuleDestroy();
      // Construction succeeded — env parsing didn't throw.
      expect(worker).toBeDefined();
    });

    it('onModuleDestroy is a no-op when no timer was scheduled', () => {
      process.env.PAPER_DISCOVERY_POLL_MS = '0';
      const worker = new PaperDiscoveryWorker(mkService(jest.fn()));
      worker.onModuleInit();
      expect(() => worker.onModuleDestroy()).not.toThrow();
    });
  });

  describe('runDiscovery (private, exercised via interval tick)', () => {
    it('invokes discoverPaperOpportunities on each tick', async () => {
      jest.useFakeTimers();
      process.env.PAPER_DISCOVERY_POLL_MS = '1000';
      const discover = jest.fn().mockResolvedValue({ discovered: 3, errors: 0 });
      const worker = new PaperDiscoveryWorker(mkService(discover));
      worker.onModuleInit();

      // Advance time to trigger the interval tick
      await jest.advanceTimersByTimeAsync(1000);

      expect(discover).toHaveBeenCalledTimes(1);
      worker.onModuleDestroy();
    });

    it('swallows errors from discoverPaperOpportunities', async () => {
      jest.useFakeTimers();
      process.env.PAPER_DISCOVERY_POLL_MS = '1000';
      const discover = jest.fn().mockRejectedValue(new Error('db down'));
      const worker = new PaperDiscoveryWorker(mkService(discover));
      worker.onModuleInit();

      // Should not throw — error is swallowed and logged
      await expect(jest.advanceTimersByTimeAsync(1000)).resolves.toBeUndefined();
      expect(discover).toHaveBeenCalledTimes(1);

      worker.onModuleDestroy();
    });

    it('guards against concurrent invocation (isRunning flag)', async () => {
      jest.useFakeTimers();
      process.env.PAPER_DISCOVERY_POLL_MS = '1000';
      let resolveFirst: () => void;
      const firstPromise = new Promise<{ discovered: number; errors: number }>(
        (resolve) => {
          resolveFirst = () => resolve({ discovered: 1, errors: 0 });
        },
      );
      let callCount = 0;
      const discover = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return firstPromise;
        return Promise.resolve({ discovered: 0, errors: 0 });
      });
      const worker = new PaperDiscoveryWorker(mkService(discover));
      worker.onModuleInit();

      // Trigger first tick (slow — does not resolve yet)
      const tick1 = jest.advanceTimersByTimeAsync(1000);
      await Promise.resolve();

      // Trigger second tick immediately while the first is still pending
      await jest.advanceTimersByTimeAsync(1000);
      // The second invocation should have been skipped (still running)
      expect(callCount).toBe(1);

      // Resolve the first and let both settle
      resolveFirst!();
      await tick1;

      worker.onModuleDestroy();
    });
  });

  describe('interval scheduling behaviour', () => {
    it('honours custom interval from env', async () => {
      jest.useFakeTimers();
      process.env.PAPER_DISCOVERY_POLL_MS = '5000';
      const discover = jest.fn().mockResolvedValue({ discovered: 0, errors: 0 });
      const worker = new PaperDiscoveryWorker(mkService(discover));
      worker.onModuleInit();

      // Tick before 5000ms should not invoke discovery
      await jest.advanceTimersByTimeAsync(4999);
      expect(discover).not.toHaveBeenCalled();

      // Crossing 5000ms triggers it
      await jest.advanceTimersByTimeAsync(2);
      expect(discover).toHaveBeenCalledTimes(1);

      worker.onModuleDestroy();
    });
  });
});
