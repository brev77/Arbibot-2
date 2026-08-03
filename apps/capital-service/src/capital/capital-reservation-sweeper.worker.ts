import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Counter } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

/**
 * Capital Reservation Expiry Sweeper (P9-9)
 *
 * Background worker that materializes `state='expired'` for active reservations
 * whose `expires_at` has passed. Before P9-9, expiry was applied only lazily
 * (in `getById`/`release`), so stale active reservations continued to count
 * against the D4-B-3 aggregate ceiling indefinitely — especially after an
 * orchestrator crash that reserved capital and never released it. This worker
 * guarantees bounded headroom: an expired reservation frees its ceiling share
 * within one sweep interval (~60s) even if no caller ever reads it.
 *
 * Single-writer: capital-service owns `capital_reservations`. The sweeper only
 * updates rows whose `expires_at < NOW()` and `state='active'` — it never
 * touches released rows and never creates rows.
 *
 * Idempotent and self-healing: re-running over already-expired rows is a no-op
 * (the WHERE clause excludes them).
 */
@Injectable()
export class CapitalReservationSweeperWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CapitalReservationSweeperWorker.name);
  private isRunning = false;
  private isShuttingDown = false;
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  private readonly expiredCounter: Counter;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {
    const registry = getArbibotMetricsRegistry();
    const metricName = 'arb_capital_expired_reservations_total';
    const existing = registry.getSingleMetric(metricName);
    this.expiredCounter =
      existing instanceof Counter
        ? existing
        : new Counter({
            name: metricName,
            help: 'Capital reservations materialized active→expired by the sweeper worker (P9-9)',
            registers: [registry],
          });
  }

  onModuleInit(): void {
    const enabled = process.env.CAPITAL_SWEEPER_ENABLED !== 'false';
    if (!enabled) {
      this.logger.log('Capital reservation sweeper disabled (CAPITAL_SWEEPER_ENABLED=false)');
      return;
    }
    const intervalMs = Number(process.env.CAPITAL_SWEEPER_INTERVAL_MS ?? 60_000);
    this.logger.log(`Starting capital reservation sweeper (interval ${intervalMs}ms)`);
    this.sweepInterval = setInterval(() => {
      void this.runSweep();
    }, intervalMs);
    this.sweepInterval.unref?.();
    // Run an initial sweep shortly after boot so a freshly-restarted service
    // does not hold stale reservations for a full interval before the first tick.
    setTimeout(() => {
      void this.runSweep();
    }, 5_000).unref?.();
  }

  onModuleDestroy(): void {
    this.isShuttingDown = true;
    if (this.sweepInterval !== null) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
    this.logger.log('Capital reservation sweeper shutting down');
  }

  /**
   * Materialize expiry for active reservations whose TTL has elapsed.
   * Returns the number of rows transitioned active→expired.
   */
  async runSweep(): Promise<number> {
    if (this.isRunning) {
      this.logger.debug('Sweep already in progress, skipping');
      return 0;
    }
    if (this.isShuttingDown) {
      return 0;
    }
    this.isRunning = true;
    try {
      const result = await this.dataSource.transaction(async (em) => {
        // UPDATE ... WHERE state='active' AND expires_at < NOW(). Lock active
        // rows for update so a concurrent reserve()/release() sees a consistent
        // state. Idempotent: expired/released rows are excluded by the predicate.
        const res = await em.query(
          `UPDATE capital_reservations
             SET state = 'expired', entity_version = entity_version + 1
           WHERE state = 'active' AND expires_at < NOW()
           RETURNING id`,
        );
        return Array.isArray(res) ? res.length : 0;
      });
      if (result > 0) {
        this.expiredCounter.inc(result);
        this.logger.log(`Capital sweeper expired ${result} stale reservation(s)`);
      }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Capital sweeper failed: ${error}`);
      return 0;
    } finally {
      this.isRunning = false;
    }
  }
}
