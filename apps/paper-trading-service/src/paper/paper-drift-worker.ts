import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Counter, Histogram } from 'prom-client';

import { PaperDriftService } from './paper-drift.service';

/**
 * Paper Drift Gauge Self-Heal Worker
 *
 * Resolves Gap #3 from Drill #1 (2026-06-15):
 * `arb_paper_drift_bps_current` gauge не self-heals — без periodic worker-а
 * gauge остаётся на последнем значении (например 76 bps) до restart сервиса.
 *
 * Worker периодически вызывает `PaperDriftService.updateStaleGauges()`, который
 * сбрасывает gauge в 0 для инструментов без свежих сэмплов (> STALE_THRESHOLD_MS).
 *
 * Конфигурация через env:
 *  - `PAPER_DRIFT_SELF_HEAL_ENABLED` (default: `true`) — feature flag
 *  - `PAPER_DRIFT_SELF_HEAL_INTERVAL_MS` (default: `60000` = 1 min)
 *
 * Manual refresh доступен через `POST /paper/drift-samples/refresh-stale`.
 */
@Injectable()
export class PaperDriftWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaperDriftWorker.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private isRunning = false;
  private isShuttingDown = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  private readonly metrics = (() => {
    const reg = getArbibotMetricsRegistry();
    return {
      cycles: new Counter({
        name: 'arb_paper_drift_self_heal_cycles_total',
        help: 'Total self-heal cycles executed (labels: success/error)',
        labelNames: ['status'],
        registers: [reg],
      }),
      staleReset: new Counter({
        name: 'arb_paper_drift_self_heal_stale_resets_total',
        help: 'Total stale instruments reset to 0 by self-heal worker',
        registers: [reg],
      }),
      latency: new Histogram({
        name: 'arb_paper_drift_self_heal_latency_ms',
        help: 'Self-heal cycle latency in milliseconds',
        buckets: [10, 50, 100, 250, 500, 1000, 5000],
        registers: [reg],
      }),
    };
  })();

  constructor(private readonly driftService: PaperDriftService) {
    this.enabled = parseBooleanEnv(process.env.PAPER_DRIFT_SELF_HEAL_ENABLED, true);
    this.intervalMs = parsePositiveIntEnv(
      process.env.PAPER_DRIFT_SELF_HEAL_INTERVAL_MS,
      60_000,
    );
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Paper drift self-heal worker is disabled by env');
      return;
    }
    this.logger.log(
      `Starting paper drift self-heal worker (interval=${this.intervalMs}ms)`,
    );
    // First cycle immediately so gauge resets don't wait up-to-one interval
    void this.runCycle('startup');
    this.intervalHandle = setInterval(() => {
      void this.runCycle('interval');
    }, this.intervalMs);
    // Don't keep Node process alive solely for this worker
    this.intervalHandle.unref?.();
  }

  onModuleDestroy(): void {
    this.isShuttingDown = true;
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.logger.log('Paper drift self-heal worker stopped');
  }

  /**
   * Manual trigger for the self-heal cycle.
   * Exposed via `POST /paper/drift-samples/refresh-stale` admin endpoint.
   */
  async trigger(): Promise<{ success: boolean; staleInstruments: number; message: string }> {
    if (this.isRunning) {
      return {
        success: false,
        staleInstruments: 0,
        message: 'Self-heal cycle already in progress',
      };
    }
    try {
      const stale = await this.runCycle('manual');
      return {
        success: true,
        staleInstruments: stale,
        message: `Self-heal completed: ${stale} stale instruments reset`,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, staleInstruments: 0, message: `Self-heal failed: ${error}` };
    }
  }

  private async runCycle(reason: 'startup' | 'interval' | 'manual'): Promise<number> {
    if (this.isShuttingDown) {
      this.logger.debug(`Skipping self-heal cycle (${reason}) — shutting down`);
      return 0;
    }
    if (this.isRunning) {
      this.logger.warn(`Self-heal cycle already running (${reason}) — skipping`);
      return 0;
    }
    this.isRunning = true;
    const startedAt = Date.now();
    try {
      const staleCount = await this.driftService.updateStaleGauges();
      const elapsedMs = Date.now() - startedAt;
      this.metrics.latency.observe(elapsedMs);
      this.metrics.cycles.inc({ status: 'success' });
      this.metrics.staleReset.inc(staleCount);
      if (staleCount > 0) {
        this.logger.log(
          `Self-heal cycle (${reason}) reset ${staleCount} stale instrument gauge(s) in ${elapsedMs}ms`,
        );
      } else {
        this.logger.debug(`Self-heal cycle (${reason}) — no stale instruments (${elapsedMs}ms)`);
      }
      return staleCount;
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      const error = err instanceof Error ? err.message : String(err);
      this.metrics.latency.observe(elapsedMs);
      this.metrics.cycles.inc({ status: 'error' });
      this.logger.error(`Self-heal cycle (${reason}) failed in ${elapsedMs}ms: ${error}`);
      throw err;
    } finally {
      this.isRunning = false;
    }
  }
}

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim().length === 0) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parsePositiveIntEnv(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value.trim().length === 0) {
    return defaultValue;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}