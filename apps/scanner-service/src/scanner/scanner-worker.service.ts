import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Counter, Gauge, Histogram } from 'prom-client';
import { ScannerInstanceStatusEntity } from '@arbibot/persistence';

import { ScannerConfigService } from './scanner-config.service';
import type { ScannerInstanceJson } from './scanner-config.types';

/**
 * Scanner worker (S1-3).
 *
 * Schedules one timer per enabled instance (not a single global interval) and runs an idle
 * cycle for each: ensure config is fresh, reconcile timers against the current instance set,
 * upsert the instance runtime row, increment counters. Cross-DEX spread detection, RPC pool
 * reads, filtering, dedup and opportunity publishing arrive in Phase 2 / Phase 3 (S1-4…S3-2).
 *
 * Skeleton mirrors paper-discovery-worker.ts:
 *   - OnModuleInit/OnModuleDestroy lifecycle
 *   - setInterval(...).unref() so the timer never keeps the event loop alive alone
 *   - isRunning guard per instance to prevent overlapping cycles
 *   - metrics bound to the shared registry via registers:[getArbibotMetricsRegistry()]
 *
 * Empty instances (the seed-045 default `{ "instances": [] }`) is a valid state: no timers
 * are scheduled and the worker logs idle. This keeps the service bootable before any
 * operator-defined instances exist.
 */
@Injectable()
export class ScannerWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScannerWorkerService.name);
  private isShuttingDown = false;
  /** Per-instance timers keyed by instance id. */
  private readonly timers = new Map<
    string,
    { interval: ReturnType<typeof setInterval>; isRunning: boolean }
  >();

  private readonly metrics = (() => {
    const reg = getArbibotMetricsRegistry();
    return {
      cyclesTotal: new Counter({
        name: 'arb_scanner_cycles_total',
        help: 'Scanner cycles completed per instance',
        labelNames: ['instance', 'status'], // success | error | skipped
        registers: [reg],
      }),
      cycleLatency: new Histogram({
        name: 'arb_scanner_cycle_latency_ms',
        help: 'Scanner cycle wall-clock latency in milliseconds',
        labelNames: ['instance'],
        buckets: [100, 500, 1000, 2000, 5000, 10000, 30000],
        registers: [reg],
      }),
      instancesActive: new Gauge({
        name: 'arb_scanner_instances_active',
        help: 'Number of enabled scanner instances currently scheduled',
        registers: [reg],
      }),
    };
  })();

  constructor(
    private readonly config: ScannerConfigService,
    @InjectRepository(ScannerInstanceStatusEntity)
    private readonly statusRepo: Repository<ScannerInstanceStatusEntity>,
  ) {}

  onModuleInit(): void {
    void this.bootstrap();
  }

  onModuleDestroy(): void {
    this.isShuttingDown = true;
    for (const entry of this.timers.values()) {
      clearInterval(entry.interval);
    }
    this.timers.clear();
    this.logger.log('Scanner worker shutting down...');
  }

  /**
   * Manual trigger for a single instance cycle (used by POST /scanner/instances/:id/run in S1-7).
   */
  async triggerInstanceRun(
    instanceId: string,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(`Manual run requested for instance ${instanceId}`);
    const instance = this.config
      .getInstances()
      .find((i) => i.id === instanceId);
    if (instance === undefined) {
      return { success: false, message: `Instance ${instanceId} not found in config` };
    }
    const entry = this.timers.get(instanceId);
    if (entry !== undefined && entry.isRunning) {
      return {
        success: false,
        message: `Instance ${instanceId} cycle already in progress`,
      };
    }
    try {
      await this.runInstanceCycle(instance);
      return { success: true, message: `Instance ${instanceId} cycle completed` };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Instance ${instanceId} cycle failed: ${error}` };
    }
  }

  /** Worker status snapshot (for GET /scanner/status in S1-7). */
  getStatus(): {
    isShuttingDown: boolean;
    scheduledInstanceIds: string[];
    runningInstanceIds: string[];
  } {
    const scheduledInstanceIds: string[] = [];
    const runningInstanceIds: string[] = [];
    for (const [id, entry] of this.timers) {
      scheduledInstanceIds.push(id);
      if (entry.isRunning) runningInstanceIds.push(id);
    }
    return {
      isShuttingDown: this.isShuttingDown,
      scheduledInstanceIds,
      runningInstanceIds,
    };
  }

  // --- internal ------------------------------------------------------------

  /**
   * Initial bootstrap: refresh config, reconcile timers, kick a first cycle per instance.
   */
  private async bootstrap(): Promise<void> {
    try {
      await this.config.ensureEffectiveConfigLoaded();
      this.reconcileTimers(this.config.getEnabledInstances());
    } catch (err) {
      // Non-fatal: timers will reconcile on the next successful config load.
      this.logger.error(
        `Bootstrap config load failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Reconcile the scheduled timer set against the currently-enabled instances.
   * Adds timers for new/renabled instances, clears timers for removed/disabled ones.
   * Called after every successful ensureEffectiveConfigLoaded so config changes apply without
   * a restart (within TTL, or immediately via forceRefresh).
   */
  private reconcileTimers(enabled: ScannerInstanceJson[]): void {
    const enabledIds = new Set(enabled.map((i) => i.id));

    // Clear timers for instances that are no longer enabled.
    for (const id of [...this.timers.keys()]) {
      if (!enabledIds.has(id)) {
        const entry = this.timers.get(id);
        if (entry !== undefined) {
          clearInterval(entry.interval);
          this.timers.delete(id);
          this.logger.log(`Removed timer for instance ${id} (disabled or removed)`);
        }
      }
    }

    // Add timers for newly-enabled instances.
    for (const instance of enabled) {
      if (this.timers.has(instance.id)) {
        continue;
      }
      const interval = setInterval(() => {
        void this.runInstanceCycle(instance);
      }, instance.interval_ms);
      interval.unref?.();
      this.timers.set(instance.id, { interval, isRunning: false });
      this.logger.log(
        `Scheduled instance ${instance.id} (${instance.network}/${instance.strategy}) every ${instance.interval_ms}ms`,
      );
      // Kick the first cycle immediately so the operator sees activity without waiting.
      void this.runInstanceCycle(instance);
    }

    this.metrics.instancesActive.set(enabled.length);
  }

  /**
   * Run one cycle for a single instance. In this slice the body is idle (no RPC/spread/publish):
   *   1. refresh config (reconciles timers if the instance set changed)
   *   2. upsert the instance runtime row (status, counters, lastRunAt, latency)
   *   3. increment arb_scanner_cycles_total
   * Cross-DEX detection is wired in Phase 2 (S2-4).
   */
  private async runInstanceCycle(instance: ScannerInstanceJson): Promise<void> {
    const entry = this.timers.get(instance.id);
    if (entry !== undefined) {
      if (entry.isRunning) {
        this.logger.warn(
          `Instance ${instance.id} cycle already in progress, skipping`,
        );
        this.metrics.cyclesTotal.inc({ instance: instance.id, status: 'skipped' });
        return;
      }
      entry.isRunning = true;
    }

    const startedAt = Date.now();
    try {
      // Refresh config + reconcile timers (cheap on cache hit). A config change (instance
      // disabled/removed/renabled) is reflected on the next reconcileTimers pass.
      await this.config.ensureEffectiveConfigLoaded();

      // If this instance was disabled during the await, log it but still record the cycle
      // so the runtime row reflects "last known cycle" rather than a stale idle.
      const stillEnabled = this.config
        .getEnabledInstances()
        .some((i) => i.id === instance.id);
      if (!stillEnabled) {
        this.logger.log(
          `Instance ${instance.id} is no longer enabled; this cycle will not reschedule`,
        );
      }

      await this.upsertStatus(instance, startedAt, 'idle', null);

      this.metrics.cyclesTotal.inc({ instance: instance.id, status: 'success' });
      this.logger.debug(
        `Instance ${instance.id} idle cycle completed in ${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Instance ${instance.id} cycle failed: ${error}`);
      await this.upsertStatus(instance, startedAt, 'error', error).catch(() => {
        /* status write failure is already logged upstream */
      });
      this.metrics.cyclesTotal.inc({ instance: instance.id, status: 'error' });
    } finally {
      this.metrics.cycleLatency
        .labels(instance.id)
        .observe(Date.now() - startedAt);
      if (entry !== undefined) {
        entry.isRunning = false;
      }
    }
  }

  /**
   * Upsert the instance runtime row. Scanner-service is the single writer of scanner_instances.
   * `cycles_total`/`findings_total`/`opportunities_published_total` are typed bigint (string).
   */
  private async upsertStatus(
    instance: ScannerInstanceJson,
    startedAt: number,
    status: 'idle' | 'error',
    lastError: string | null,
  ): Promise<void> {
    const latencyMs = Date.now() - startedAt;
    const existing = await this.statusRepo.findOne({
      where: { instanceId: instance.id },
    });
    const cyclesTotal =
      BigInt(existing?.cyclesTotal ?? '0') + BigInt(1);

    await this.statusRepo.save({
      instanceId: instance.id,
      status,
      cyclesTotal: cyclesTotal.toString(),
      findingsTotal: existing?.findingsTotal ?? '0',
      opportunitiesPublishedTotal:
        existing?.opportunitiesPublishedTotal ?? '0',
      lastCycleLatencyMs: latencyMs,
      lastRunAt: new Date(startedAt),
      lastError,
    });
  }
}
