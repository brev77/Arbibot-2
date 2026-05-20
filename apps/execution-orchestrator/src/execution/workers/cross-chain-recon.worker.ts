import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { CrossChainReconciliationService } from '../reconciliation/cross-chain-reconciliation.service';

// ───────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────

/** Default reconciliation interval: 60 seconds. */
const DEFAULT_RECON_INTERVAL_MS = 60_000;

/** Default stale threshold: 30 minutes. */
const DEFAULT_STALE_THRESHOLD_MS = 1_800_000;

// ───────────────────────────────────────────────────────────────────────
// Worker
// ───────────────────────────────────────────────────────────────────────

/**
 * Cross-chain reconciliation worker.
 *
 * Step: DEX-2-3-RECON-XCHAIN
 *
 * Periodically runs bridge transfer reconciliation to detect
 * mismatches and stale transfers.
 *
 * Enabled when `CROSS_CHAIN_RECON_ENABLED=true`.
 *
 * Env vars:
 *   CROSS_CHAIN_RECON_ENABLED      — enable/disable (default: false)
 *   CROSS_CHAIN_RECON_INTERVAL_MS  — check interval (default: 60000)
 *   CROSS_CHAIN_RECON_STALE_MS     — stale threshold (default: 1800000)
 */
@Injectable()
export class CrossChainReconWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrossChainReconWorker.name);

  private timer?: NodeJS.Timeout;
  private readonly intervalMs: number;
  private readonly staleThresholdMs: number;

  constructor(
    private readonly reconService: CrossChainReconciliationService,
  ) {
    this.intervalMs = Number(
      process.env.CROSS_CHAIN_RECON_INTERVAL_MS ?? DEFAULT_RECON_INTERVAL_MS,
    );
    this.staleThresholdMs = Number(
      process.env.CROSS_CHAIN_RECON_STALE_MS ?? DEFAULT_STALE_THRESHOLD_MS,
    );
  }

  onModuleInit(): void {
    const enabled = process.env.CROSS_CHAIN_RECON_ENABLED === 'true';
    if (!enabled) {
      this.logger.log(
        'Cross-chain reconciliation worker disabled (CROSS_CHAIN_RECON_ENABLED not set)',
      );
      return;
    }

    this.logger.log(
      `Starting cross-chain reconciliation worker ` +
      `(interval=${this.intervalMs}ms, staleThreshold=${this.staleThresholdMs}ms)`,
    );
    this.startTimer();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.logger.log('Cross-chain reconciliation worker stopped');
  }

  /**
   * Execute a single reconciliation cycle.
   *
   * Visible for testing.
   */
  async runOnce(): Promise<{
    mismatches: number;
    stale: number;
    healthy: boolean;
  }> {
    try {
      const status = await this.reconService.runFullReconciliation(
        this.staleThresholdMs,
      );

      this.logger.log(
        `Reconciliation cycle complete: ` +
        `mismatches=${status.totalMismatches} stale=${status.totalStale} ` +
        `healthy=${status.healthy}`,
      );

      return {
        mismatches: status.totalMismatches,
        stale: status.totalStale,
        healthy: status.healthy,
      };
    } catch (error) {
      this.logger.error(
        `Reconciliation cycle failed: ${String(error)}`,
      );
      return { mismatches: 0, stale: 0, healthy: false };
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────────────

  private startTimer(): void {
    this.timer = setInterval(() => {
      void this.runOnce().catch((err) => {
        this.logger.error(`Reconciliation timer error: ${String(err)}`);
      });
    }, this.intervalMs);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }
}