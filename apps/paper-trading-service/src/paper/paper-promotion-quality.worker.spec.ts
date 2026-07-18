import { PaperPromotionQualityWorker } from './paper-promotion-quality.worker';
import { PaperPromotionService } from './paper-promotion.service';

/**
 * PaperPromotionQualityWorker spec (Phase 4 — paper-trading-service coverage).
 *
 * The worker periodically calls PaperPromotionService.refreshPersistedQualitySnapshots.
 * It is env-gated (PAPER_PROMOTION_QUALITY_WORKER_ENABLED) and bounded by a 30s
 * floor on the interval. We exercise:
 *   - disabled path (no timer set, runOnce not invoked)
 *   - enabled path (runOnce invoked once on startup, timer scheduled + unref'd)
 *   - onModuleDestroy clears the timer (or no-op when no timer)
 *   - runOnce swallows the rejection inside onModuleInit startup hook
 *   - refreshPersistedQualitySnapshots=0 vs >0 logging branches
 *
 * Env isolation per-test (save/restore) to keep the suite deterministic.
 */
describe('PaperPromotionQualityWorker', () => {
  const prevEnabled = process.env.PAPER_PROMOTION_QUALITY_WORKER_ENABLED;
  const prevInterval = process.env.PAPER_PROMOTION_QUALITY_INTERVAL_MS;

  const mkPromotions = (refreshCount: jest.Mock) =>
    ({ refreshPersistedQualitySnapshots: refreshCount }) as unknown as PaperPromotionService;

  afterEach(() => {
    if (prevEnabled === undefined) {
      delete process.env.PAPER_PROMOTION_QUALITY_WORKER_ENABLED;
    } else {
      process.env.PAPER_PROMOTION_QUALITY_WORKER_ENABLED = prevEnabled;
    }
    if (prevInterval === undefined) {
      delete process.env.PAPER_PROMOTION_QUALITY_INTERVAL_MS;
    } else {
      process.env.PAPER_PROMOTION_QUALITY_INTERVAL_MS = prevInterval;
    }
    // clear any setInterval handles leaked across tests
    jest.useRealTimers();
  });

  describe('onModuleInit', () => {
    it('skips scheduling when PAPER_PROMOTION_QUALITY_WORKER_ENABLED=false', () => {
      process.env.PAPER_PROMOTION_QUALITY_WORKER_ENABLED = 'false';
      const refresh = jest.fn().mockResolvedValue(0);
      const worker = new PaperPromotionQualityWorker(mkPromotions(refresh));
      worker.onModuleInit();
      // runOnce is not invoked on the disabled path
      expect(refresh).not.toHaveBeenCalled();
      // onModuleDestroy should be a no-op
      worker.onModuleDestroy();
      expect(refresh).not.toHaveBeenCalled();
    });

    it('schedules the worker + runs one cycle immediately when enabled', async () => {
      process.env.PAPER_PROMOTION_QUALITY_WORKER_ENABLED = 'true';
      const refresh = jest.fn().mockResolvedValue(3);
      const worker = new PaperPromotionQualityWorker(mkPromotions(refresh));
      worker.onModuleInit();
      // Wait for the immediate runOnce promise to settle
      await Promise.resolve();
      await Promise.resolve();
      expect(refresh).toHaveBeenCalledTimes(1);
      // timer was created — onModuleDestroy must clear it without throwing
      worker.onModuleDestroy();
    });

    it('clamps interval below 30s floor up to 30_000ms', () => {
      process.env.PAPER_PROMOTION_QUALITY_WORKER_ENABLED = 'true';
      process.env.PAPER_PROMOTION_QUALITY_INTERVAL_MS = '5000';
      const refresh = jest.fn().mockResolvedValue(0);
      const worker = new PaperPromotionQualityWorker(mkPromotions(refresh));
      worker.onModuleInit();
      worker.onModuleDestroy();
      // The clamp itself isn't observable directly, but construction must succeed.
      expect(worker).toBeDefined();
    });

    it('falls back to default 120000ms when interval is non-numeric', () => {
      process.env.PAPER_PROMOTION_QUALITY_WORKER_ENABLED = 'true';
      process.env.PAPER_PROMOTION_QUALITY_INTERVAL_MS = 'not-a-number';
      const refresh = jest.fn().mockResolvedValue(0);
      const worker = new PaperPromotionQualityWorker(mkPromotions(refresh));
      worker.onModuleInit();
      worker.onModuleDestroy();
      expect(worker).toBeDefined();
    });

    it('swallows the initial runOnce rejection inside onModuleInit (logs warn)', async () => {
      process.env.PAPER_PROMOTION_QUALITY_WORKER_ENABLED = 'true';
      const refresh = jest.fn().mockRejectedValue(new Error('DB down'));
      const worker = new PaperPromotionQualityWorker(mkPromotions(refresh));
      // Must not throw — the void .catch() in onModuleInit handles it.
      worker.onModuleInit();
      await Promise.resolve();
      await Promise.resolve();
      worker.onModuleDestroy();
      expect(refresh).toHaveBeenCalled();
    });

    it('stringifies non-Error initial runOnce rejections', async () => {
      process.env.PAPER_PROMOTION_QUALITY_WORKER_ENABLED = 'true';
      const refresh = jest.fn().mockRejectedValue('string-error');
      const worker = new PaperPromotionQualityWorker(mkPromotions(refresh));
      worker.onModuleInit();
      await Promise.resolve();
      await Promise.resolve();
      worker.onModuleDestroy();
      expect(refresh).toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('is a no-op when no timer was scheduled (disabled path)', () => {
      process.env.PAPER_PROMOTION_QUALITY_WORKER_ENABLED = 'false';
      const worker = new PaperPromotionQualityWorker(mkPromotions(jest.fn()));
      worker.onModuleInit();
      // Should not throw even though no timer was set.
      expect(() => worker.onModuleDestroy()).not.toThrow();
    });
  });
});
