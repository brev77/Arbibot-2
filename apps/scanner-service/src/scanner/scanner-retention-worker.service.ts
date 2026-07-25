import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { Counter } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { ScannerFindingEntity } from '@arbibot/persistence';

import {
  DEFAULT_SCANNER_FINDINGS_RETENTION_DAYS,
  DEFAULT_SCANNER_RETENTION_INTERVAL_MS,
} from './scanner-config.constants';
import { ScannerConfigService } from './scanner-config.service';

/**
 * Findings retention cleanup worker (S5-2-RETENTION).
 *
 * Periodically deletes `scanner_findings` rows older than
 * `scanner.defaults.findingsRetentionDays` (default 7). At MVP load (2 chains × ~150
 * combinations × cycle 2s) the table grows by thousands of rows per hour — without retention
 * it bloats within a week and slows the UI findings queries + the orphan worker scan.
 *
 * The delete is bounded: TypeORM `.delete({ observedAt: LessThan(cutoff) })` translates to a
 * single `DELETE ... WHERE observed_at < ?` backed by the `idx_scanner_findings_observed_at`
 * index (migration 044). No pagination needed at MVP volume; if a single DELETE ever becomes
 * too large we can batch it (non-goal for now).
 *
 * Skeleton mirrors scanner-orphan-worker: OnModuleInit/OnModuleDestroy + setInterval().unref()
 * + isRunning guard + metric on the shared registry.
 *
 * Env overrides:
 *   SCANNER_FINDINGS_RETENTION_DAYS — override `scanner.defaults.findingsRetentionDays`
 *   SCANNER_RETENTION_INTERVAL_MS   — override the hourly interval
 *   SCANNER_RETENTION_ENABLED=false — disable the worker entirely (e.g. for tests)
 */
@Injectable()
export class ScannerRetentionWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ScannerRetentionWorkerService.name);
  private isRunning = false;
  private isShuttingDown = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly cleanedTotal: Counter<string>;

  constructor(
    @InjectRepository(ScannerFindingEntity)
    private readonly findingsRepo: Repository<ScannerFindingEntity>,
    private readonly config: ScannerConfigService,
  ) {
    const reg = getArbibotMetricsRegistry();
    const existing = reg.getSingleMetric(
      'arb_scanner_findings_cleaned_total',
    ) as Counter<string> | undefined;
    this.cleanedTotal =
      existing ??
      new Counter({
        name: 'arb_scanner_findings_cleaned_total',
        help: 'Scanner findings deleted by the retention cleanup worker',
        labelNames: ['instance'],
        registers: [reg],
      });
  }

  onModuleInit(): void {
    if (!this.isEnabled()) {
      this.logger.log('Retention cleanup worker disabled (SCANNER_RETENTION_ENABLED=false)');
      return;
    }
    const intervalMs = this.resolveIntervalMs();
    this.timer = setInterval(() => {
      void this.runCycle();
    }, intervalMs);
    this.timer.unref?.();
    this.logger.log(
      `Retention cleanup worker started (interval ${intervalMs}ms, retention ${this.resolveRetentionDays()} days)`,
    );
  }

  onModuleDestroy(): void {
    this.isShuttingDown = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run one cleanup cycle. Deletes findings older than the retention cutoff and records the
   * count in `arb_scanner_findings_cleaned_total`. Exposed for unit tests.
   */
  async runCycle(): Promise<{ cutoff: Date; deleted: number }> {
    if (this.isRunning || this.isShuttingDown) {
      return { cutoff: new Date(0), deleted: 0 };
    }
    this.isRunning = true;
    try {
      const retentionDays = this.resolveRetentionDays();
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const result = await this.findingsRepo.delete({
        observedAt: LessThan(cutoff),
      });
      const deleted = typeof result.affected === 'number' ? result.affected : 0;
      if (deleted > 0) {
        this.cleanedTotal.inc({ instance: 'global' }, deleted);
        this.logger.log(
          `Retention cleanup: deleted ${deleted} findings older than ${retentionDays} days (before ${cutoff.toISOString()})`,
        );
      }
      return { cutoff, deleted };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Retention cleanup cycle failed: ${msg}`);
      return { cutoff: new Date(0), deleted: 0 };
    } finally {
      this.isRunning = false;
    }
  }

  private isEnabled(): boolean {
    const raw = process.env.SCANNER_RETENTION_ENABLED?.trim().toLowerCase();
    return raw !== 'false' && raw !== '0' && raw !== 'off';
  }

  private resolveRetentionDays(): number {
    const env = process.env.SCANNER_FINDINGS_RETENTION_DAYS;
    if (env !== undefined && env.length > 0) {
      const n = Number(env);
      if (Number.isFinite(n) && n > 0) {
        return n;
      }
    }
    const fromConfig = this.config.getConfig().defaults.findingsRetentionDays;
    return fromConfig > 0
      ? fromConfig
      : DEFAULT_SCANNER_FINDINGS_RETENTION_DAYS;
  }

  private resolveIntervalMs(): number {
    const raw = process.env.SCANNER_RETENTION_INTERVAL_MS;
    if (raw !== undefined && raw.length > 0) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) {
        return n;
      }
    }
    return DEFAULT_SCANNER_RETENTION_INTERVAL_MS;
  }
}
