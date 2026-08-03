import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Counter } from 'prom-client';

import { MismatchesService } from './mismatches.service';

/**
 * Reconciliation Detector Cron Worker (P9-7).
 *
 * Previously `runDetectors` was only invoked by a manual `POST
 * /mismatches/run-detectors` — mismatches could sit undetected for the entire
 * trading window. This worker runs `runDetectors` on a configurable interval
 * (default 60s) so desyncs between execution and portfolio/capital are caught
 * automatically. Single-writer boundaries are respected: the worker only
 * triggers detection (which inserts/updates `reconciliation_mismatches`, owned
 * by reconciliation-service); it does not touch any other service's tables.
 */
@Injectable()
export class ReconciliationDetectorCronWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationDetectorCronWorker.name);
  private isRunning = false;
  private isShuttingDown = false;
  private cronInterval: ReturnType<typeof setInterval> | null = null;

  private readonly cycleCounter: Counter;

  constructor(private readonly mismatchesService: MismatchesService) {
    const registry = getArbibotMetricsRegistry();
    const metricName = 'arb_reconciliation_run_total';
    const existing = registry.getSingleMetric(metricName);
    this.cycleCounter =
      existing instanceof Counter
        ? (existing)
        : new Counter({
            name: metricName,
            help: 'Reconciliation detector cron cycles (P9-7)',
            labelNames: ['status'],
            registers: [registry],
          });
  }

  onModuleInit(): void {
    const enabled = process.env.RECON_DETECTOR_ENABLED !== 'false';
    if (!enabled) {
      this.logger.log('Reconciliation detector cron disabled (RECON_DETECTOR_ENABLED=false)');
      return;
    }
    const intervalMs = Number(process.env.RECON_DETECTOR_INTERVAL_MS ?? 60_000);
    this.logger.log(`Starting reconciliation detector cron (interval ${intervalMs}ms)`);
    this.cronInterval = setInterval(() => {
      void this.runCycle();
    }, intervalMs);
    this.cronInterval.unref?.();
    // Run an initial cycle shortly after boot.
    setTimeout(() => {
      void this.runCycle();
    }, 10_000).unref?.();
  }

  onModuleDestroy(): void {
    this.isShuttingDown = true;
    if (this.cronInterval !== null) {
      clearInterval(this.cronInterval);
      this.cronInterval = null;
    }
    this.logger.log('Reconciliation detector cron shutting down');
  }

  async runCycle(): Promise<void> {
    if (this.isRunning || this.isShuttingDown) {
      return;
    }
    this.isRunning = true;
    try {
      const result = await this.mismatchesService.runDetectors();
      this.cycleCounter.inc({ status: 'success' });
      this.logger.debug(
        `Reconciliation cycle: ${result.inserted ?? 0} mismatches inserted`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Reconciliation detector cycle failed: ${msg}`);
      this.cycleCounter.inc({ status: 'error' });
    } finally {
      this.isRunning = false;
    }
  }
}
