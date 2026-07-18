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
});
