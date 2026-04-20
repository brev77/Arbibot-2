import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PaperPromotionService } from './paper-promotion.service';

/**
 * Periodically persists PRIO-P2-PROMO quality snapshots for open promotion candidates.
 * Env: PAPER_PROMOTION_QUALITY_WORKER_ENABLED (default true), PAPER_PROMOTION_QUALITY_INTERVAL_MS (default 120000).
 */
@Injectable()
export class PaperPromotionQualityWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaperPromotionQualityWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly promotions: PaperPromotionService) {}

  onModuleInit(): void {
    const disabled = process.env.PAPER_PROMOTION_QUALITY_WORKER_ENABLED === 'false';
    if (disabled) {
      this.logger.log('Paper promotion quality worker disabled');
      return;
    }
    const ms = Math.max(
      30_000,
      Number.parseInt(process.env.PAPER_PROMOTION_QUALITY_INTERVAL_MS ?? '120000', 10) ||
        120_000,
    );
    void this.runOnce().catch((err: unknown) => {
      this.logger.warn(
        `initial quality refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    this.timer = setInterval(() => {
      void this.runOnce().catch((err: unknown) => {
        this.logger.warn(
          `quality refresh failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, ms);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runOnce(): Promise<void> {
    const n = await this.promotions.refreshPersistedQualitySnapshots();
    if (n > 0) {
      this.logger.debug(`Refreshed quality for ${n} promotion candidate(s)`);
    }
  }
}
