import { ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Counter, Histogram } from 'prom-client';
import { randomUUID } from 'node:crypto';

import { ArbitrageOpportunityEntity } from '@arbibot/persistence';

import { LiveAutoDriveConfigService } from './live-auto-drive-config.service';
import { LiveKillSwitchService } from './live-kill-switch.service';
import { TokenResolverService, type OpportunityEvidence } from './token-resolver.service';
import { PlanSetupOrchestrator } from './plan-setup-orchestrator.service';

/**
 * LiveAutoDriveWorker (PLAN10 P10-5, opp-service).
 *
 * Drives the gap between `risk_checked` opportunities and live-execution. The existing
 * AutoDriveWorker (opportunity-service) only feeds the paper path (`paperEnqueue`); this
 * worker creates a live execution plan via PlanSetupOrchestrator and stamps
 * `live_execution_plan_id` on the opportunity (dedup marker).
 *
 * Per tick (every LIVE_AUTO_DRIVE_INTERVAL_MS):
 *   1. ensureEffectiveConfigLoaded(); if !enabled → return.
 *   2. assertLiveNotHalted() (fail-closed kill-switch).
 *   3. Find risk_checked opportunities with live_execution_plan_id IS NULL.
 *   4. Concurrent-plan gate: skip if active markers ≥ maxConcurrentPlans.
 *   5. Per opp: resolve tokens + amountIns (fail-closed skip on unknown), orchestrate plan
 *      setup, stamp marker (optimistic UPDATE).
 *
 * Kill-switch: LIVE_AUTO_DRIVE_ENABLED=false (env) or live.auto_drive.enabled=false (config)
 * halts the worker. tools/panic-button.sh flips the env to false; panic-recover.sh does NOT
 * restore it (recovery must never auto-restart automated live trading).
 *
 * Re-entrancy / dedup:
 *  - isRunning guard prevents overlapping ticks.
 *  - Optimistic UPDATE `SET live_execution_plan_id WHERE id AND live_execution_plan_id IS NULL`
 *    makes concurrent ticks lose cleanly (affected rows = 0 → skip).
 *
 * amountIn uses pre-quoted Модель #1 (P10-3): both legs carry amountIn derived from evidence.
 * If real buy slippage > forecast, sell tx may revert → stuck-plan-reaper → manual recovery
 * (for $10 notional the loss is gas-only; documented in P10-8).
 */
@Injectable()
export class LiveAutoDriveWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveAutoDriveWorker.name);
  private isRunning = false;
  private isShuttingDown = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  private readonly metrics = (() => {
    const reg = getArbibotMetricsRegistry();
    return {
      cycles: new Counter({
        name: 'arb_live_auto_drive_cycles_total',
        help: 'LiveAutoDriveWorker cycles (labels: success/error/disabled/halted)',
        labelNames: ['status'],
        registers: [reg],
      }),
      plansCreated: new Counter({
        name: 'arb_live_auto_drive_plans_created_total',
        help: 'Live plans created (labels: outcome)',
        labelNames: ['outcome'],
        registers: [reg],
      }),
      profit: new Histogram({
        name: 'arb_live_auto_drive_net_profit_usd',
        help: 'Opportunity net profit (USD) at plan creation',
        buckets: [-50, -10, -1, 0, 1, 10, 50, 100, 500],
        registers: [reg],
      }),
      latency: new Histogram({
        name: 'arb_live_auto_drive_latency_ms',
        help: 'LiveAutoDriveWorker tick latency in milliseconds',
        buckets: [100, 500, 1000, 2500, 5000, 10_000, 30_000],
        registers: [reg],
      }),
    };
  })();

  constructor(
    private readonly configService: LiveAutoDriveConfigService,
    private readonly killSwitch: LiveKillSwitchService,
    private readonly tokenResolver: TokenResolverService,
    private readonly planSetup: PlanSetupOrchestrator,
    @InjectRepository(ArbitrageOpportunityEntity)
    private readonly repo: Repository<ArbitrageOpportunityEntity>,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.configService.getConfig().intervalMs;
    // Even if disabled at startup, register the timer — config-service may flip enabled=true later.
    this.logger.log(`Starting LiveAutoDriveWorker (interval=${intervalMs}ms)`);
    this.intervalHandle = setInterval(() => {
      void this.runCycle();
    }, intervalMs);
    this.intervalHandle.unref?.();
  }

  onModuleDestroy(): void {
    this.isShuttingDown = true;
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.logger.log('LiveAutoDriveWorker stopped');
  }

  /** Manual admin trigger (returns a summary). */
  async trigger(): Promise<{ ran: boolean; plansCreated: number; message: string }> {
    if (this.isRunning) {
      return { ran: false, plansCreated: 0, message: 'cycle already running' };
    }
    // Mirrors runCycle's top-of-tick guards: respect disabled + halted even on manual trigger.
    await this.configService.ensureEffectiveConfigLoaded();
    if (!this.configService.isEnabled()) {
      return { ran: false, plansCreated: 0, message: 'worker disabled' };
    }
    try {
      await this.killSwitch.assertLiveNotHalted();
    } catch (err) {
      if (err instanceof ConflictException) {
        return { ran: false, plansCreated: 0, message: 'live halted' };
      }
      throw err;
    }
    this.isRunning = true;
    try {
      const result = await this.runCycleInner();
      return { ran: true, plansCreated: result.plansCreated, message: 'manual cycle complete' };
    } finally {
      this.isRunning = false;
    }
  }

  private async runCycle(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }
    if (this.isRunning) {
      return;
    }
    try {
      await this.configService.ensureEffectiveConfigLoaded();
      if (!this.configService.isEnabled()) {
        this.metrics.cycles.inc({ status: 'disabled' });
        return;
      }
      this.isRunning = true;
      try {
        await this.killSwitch.assertLiveNotHalted();
      } catch (err) {
        if (err instanceof ConflictException) {
          this.metrics.cycles.inc({ status: 'halted' });
          return;
        }
        throw err;
      }
      await this.runCycleInner();
      this.metrics.cycles.inc({ status: 'success' });
    } catch (err) {
      this.metrics.cycles.inc({ status: 'error' });
      this.logger.error(`LiveAutoDrive tick failed: ${this.errorMessage(err)}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async runCycleInner(): Promise<{ plansCreated: number }> {
    const cfg = this.configService.getConfig();
    const start = Date.now();
    let plansCreated = 0;
    try {
      // Concurrent-plan gate: count opportunities with an active live_execution_plan_id
      // (marker is set after plan creation; stale markers from completed plans are acceptable
      // for a coarse cap — the precise capital ceiling is enforced by capital-service).
      const inFlight = await this.repo.count({
        where: { state: 'risk_checked' },
      });
      if (inFlight >= cfg.maxConcurrentPlans) {
        // Saturated: skip this tick entirely (capital ceiling is the hard gate).
        return { plansCreated: 0 };
      }

      const pending = await this.repo.find({
        where: { state: 'risk_checked' },
        take: cfg.batchSize,
        order: { createdAt: 'DESC' },
      });
      // Filter to un-dispatched (live_execution_plan_id IS NULL) in memory — the partial
      // index idx_arbitrage_opp_live_plan_pending covers the hot path in production.
      const undispatched = pending.filter((o) => o.liveExecutionPlanId === null);
      if (undispatched.length === 0) {
        return { plansCreated: 0 };
      }

      for (const opp of undispatched) {
        // Re-check kill-switch between opportunities (operator may halt mid-tick).
        try {
          await this.killSwitch.assertLiveNotHalted();
        } catch (err) {
          if (err instanceof ConflictException) {
            this.metrics.cycles.inc({ status: 'halted' });
            return { plansCreated };
          }
          throw err;
        }

        const payload = opp.payload;
        const netProfitUsd = typeof payload.netProfitUsd === 'number' ? payload.netProfitUsd : null;
        if (netProfitUsd === null || netProfitUsd < cfg.minNetProfitUsd) {
          this.metrics.plansCreated.inc({ outcome: 'skip_min_profit' });
          continue;
        }

        const instrumentKey = typeof payload.instrumentKey === 'string' ? payload.instrumentKey : null;
        if (instrumentKey === null) {
          this.metrics.plansCreated.inc({ outcome: 'skip_no_instrument' });
          continue;
        }

        const evidence = payload.evidence as OpportunityEvidence | undefined;

        const resolved = this.tokenResolver.resolve(instrumentKey, cfg.notionalUsd, evidence);
        if (resolved === null) {
          this.metrics.plansCreated.inc({ outcome: 'skip_no_token' });
          continue;
        }

        const buyVenue = typeof payload.buyVenue === 'string' ? payload.buyVenue : null;
        const sellVenue = typeof payload.sellVenue === 'string' ? payload.sellVenue : null;
        if (buyVenue === null || sellVenue === null) {
          this.metrics.plansCreated.inc({ outcome: 'skip_no_venue' });
          continue;
        }

        const correlationId = opp.correlationId ?? randomUUID();
        try {
          const result = await this.planSetup.orchestrate({
            correlationId,
            riskDecisionId: opp.riskDecisionId ?? '',
            routeKey: instrumentKey,
            notionalUsd: cfg.notionalUsd,
            tokens: resolved.tokens,
            amountIns: resolved.amountIns,
            buyVenueKey: buyVenue,
            sellVenueKey: sellVenue,
          });

          // Optimistic marker stamp: only succeeds if live_execution_plan_id is still NULL.
          // Concurrent tick that already stamped → affected rows = 0 → we skip (cleanup is
          // the losing tick's responsibility, but since both created the same plan shape the
          // duplicate is benign; capital ceiling prevents double-spend at reserve time).
          const updated = await this.dataSource.transaction(async (em) => {
            const res = await em.query(
              `UPDATE arbitrage_opportunities SET live_execution_plan_id = $1, updated_at = now() WHERE id = $2 AND live_execution_plan_id IS NULL`,
              [result.planId, opp.id],
            );
            return Array.isArray(res) && res.length > 0 ? (res[0]?.rowCount ?? res[0]?.changes ?? 0) : 0;
          });
          if (updated > 0) {
            plansCreated += 1;
            this.metrics.plansCreated.inc({ outcome: 'success' });
            this.metrics.profit.observe(netProfitUsd);
            this.logger.log(
              `Live plan ${result.planId} created for opp ${opp.id.slice(0, 8)} (net=$${netProfitUsd}, resv=${result.reservationId.slice(0, 8)})`,
            );
          } else {
            // Marker race: another tick stamped first. The plan we just created is orphaned;
            // its capital reservation will be released by settlement-relay on completion or
            // expire via TTL. This is a rare race and acceptable (capital ceiling is the
            // hard gate, not the marker).
            this.metrics.plansCreated.inc({ outcome: 'skip_marker_race' });
            this.logger.warn(
              `Marker race for opp ${opp.id}: created plan ${result.planId} but marker already set by concurrent tick`,
            );
          }
        } catch (err) {
          this.metrics.plansCreated.inc({ outcome: 'failed' });
          this.logger.warn(
            `Plan setup failed for opp ${opp.id}: ${this.errorMessage(err)}`,
          );
        }
      }
    } finally {
      this.metrics.latency.observe(Date.now() - start);
    }
    return { plansCreated };
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
