import { ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Counter, Histogram } from 'prom-client';
import { randomUUID } from 'node:crypto';

import { ExecutionLegEntity, ExecutionPlanEntity } from '@arbibot/persistence';

import { DexKillSwitchService } from '../execution/risk/dex-kill-switch.service';
import { isLiveVenueKey } from '../execution/venue-factory.service';
import { PlansService } from '../plans/plans.service';
import { LegsService } from './legs.service';

/**
 * LegAutoDriverWorker (PLAN10 P10-EO, execution-orchestrator).
 *
 * Closes the gap that `beginExecution` creates legs in state `created` but nothing inside
 * execution-orchestrator drives them forward — the HTTP endpoints (mark-sent/ack/fill)
 * are only called by external clients. Without this worker, plans stay in `executing`
 * forever (zombie plans).
 *
 * Tick (every LEG_AUTO_DRIVE_INTERVAL_MS):
 *   1. SELECT created legs whose plan is `executing` AND venueKey is a live DEX venue
 *      (Р2-4: paper-dex excluded — `isLiveVenueKey` from venue-factory.service.ts:52).
 *   2. Р2-3: process legs SEQUENTIALLY per plan (buy → fill → sell), never Promise.all
 *      (arbitrage is semantically buy-first; also removes nonce contention even though
 *      NonceManager already serializes broadcast).
 *   3. For each leg:
 *        - assertLiveNotHalted() (fail-closed; Р2-1 + capital safety).
 *        - markSent() → Р2-1: re-check leg state. If `submitting` → skip (tx pending;
 *          markAcknowledged requires strictly `sent` legs.service.ts:688-691). If `sent`
 *          → continue.
 *        - markAcknowledged() (only if sent).
 *        - applyFill({mode:'full'}) → filled. sell amountIn is pre-set (Модель #1, P10-3).
 *   4. After all legs of a plan filled → PlansService.tryMarkPlanCompletedWhenAllLegsFilled
 *      emits PlanCompleted outbox (consumed by settlement-relay for capital release + the
 *      P10-FB HTTP callback to opportunity-service).
 *
 * Error handling:
 *   - markSent 422 (client/terminal) → leg failed; plan stays incomplete; stuck-plan-reaper
 *     alerts after 30 min.
 *   - markSent 503 (transient) → leg stays `submitting`; worker skips it next tick;
 *     stuck-plan-reaper reconciles (~5-6 min).
 *   - Р2-5 reverted sell: if sell reverts because pre-quoted amountIn exceeded actual
 *     received balance (buy got less than forecast), leg → failed → manual recovery. For
 *     $10 notional the loss is gas-only.
 *   - kill-switch 409 → skip leg (retry next tick after recover).
 *
 * Isolation: on-chain broadcast happens inside markSent (two-phase P9-1: created→submitting
 * commit, broadcast outside tx, submitting→sent commit). This worker never holds a DB tx
 * across the on-chain wait — it calls the public LegsService methods.
 *
 * Kill-switch: LEG_AUTO_DRIVE_ENABLED=false (env) halts. Default false (safe-by-default);
 * tools/panic-button.sh flips it false; panic-recover.sh does NOT restore it.
 */
@Injectable()
export class LegAutoDriverWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LegAutoDriverWorker.name);
  private isRunning = false;
  private isShuttingDown = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  private readonly metrics = (() => {
    const reg = getArbibotMetricsRegistry();
    return {
      cycles: new Counter({
        name: 'arb_leg_auto_drive_cycles_total',
        help: 'LegAutoDriverWorker cycles (labels: success/error/disabled/halted)',
        labelNames: ['status'],
        registers: [reg],
      }),
      legsProcessed: new Counter({
        name: 'arb_leg_auto_drive_legs_processed_total',
        help: 'Legs processed by LegAutoDriverWorker (labels: outcome)',
        labelNames: ['outcome'],
        registers: [reg],
      }),
      plansCompleted: new Counter({
        name: 'arb_leg_auto_drive_plans_completed_total',
        help: 'Plans driven to completed state',
        labelNames: ['outcome'],
        registers: [reg],
      }),
      latency: new Histogram({
        name: 'arb_leg_auto_drive_latency_ms',
        help: 'LegAutoDriverWorker tick latency in milliseconds',
        buckets: [100, 500, 1000, 5000, 15_000, 30_000, 60_000],
        registers: [reg],
      }),
    };
  })();

  constructor(
    private readonly legs: LegsService,
    private readonly plans: PlansService,
    private readonly killSwitch: DexKillSwitchService,
    @InjectRepository(ExecutionLegEntity)
    private readonly legsRepo: Repository<ExecutionLegEntity>,
    @InjectRepository(ExecutionPlanEntity)
    private readonly plansRepo: Repository<ExecutionPlanEntity>,
  ) {}

  onModuleInit(): void {
    const enabled = this.isEnabled();
    const intervalMs = this.intervalMs();
    if (!enabled) {
      this.logger.log('LegAutoDriverWorker disabled (LEG_AUTO_DRIVE_ENABLED unset/false)');
      // Still register the timer so flipping the env via process restart picks it up;
      // if disabled by env only (no config-service), the operator restarts to enable.
    }
    this.logger.log(`Starting LegAutoDriverWorker (interval=${intervalMs}ms, enabled=${enabled})`);
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
    this.logger.log('LegAutoDriverWorker stopped');
  }

  private isEnabled(): boolean {
    const raw = process.env.LEG_AUTO_DRIVE_ENABLED;
    if (raw === undefined || raw.length === 0) {
      return false;
    }
    return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
  }

  private intervalMs(): number {
    const raw = process.env.LEG_AUTO_DRIVE_INTERVAL_MS;
    const n = raw !== undefined ? Number.parseInt(raw, 10) : Number.NaN;
    if (!Number.isFinite(n) || n < 500) {
      return 2000;
    }
    return n;
  }

  /**
   * Upper bound for a single `markSent` call. markSent performs the on-chain
   * broadcast (two-phase P9-1: created→submitting commit, broadcast, submitting
   * →sent commit) plus a tx.wait for the receipt. A hung RPC inside markSent
   * blocks the whole worker (isRunning guard) and stalls every other plan. On
   * timeout the leg stays `submitting` and the stuck-plan-reaper (P9-7)
   * reconciles it — the tx is NOT lost (the confirmation poller resolves it).
   */
  private markSentTimeoutMs(): number {
    const raw = process.env.MARK_SENT_TIMEOUT_MS;
    const n = raw !== undefined ? Number.parseInt(raw, 10) : Number.NaN;
    if (!Number.isFinite(n) || n <= 0) {
      return 90_000;
    }
    return n;
  }

  private async runCycle(): Promise<void> {
    if (this.isShuttingDown || this.isRunning) {
      return;
    }
    if (!this.isEnabled()) {
      this.metrics.cycles.inc({ status: 'disabled' });
      return;
    }
    this.isRunning = true;
    const start = Date.now();
    try {
      await this.killSwitch.assertLiveNotHalted();
      await this.drivePendingLegs();
      this.metrics.cycles.inc({ status: 'success' });
    } catch (err) {
      if (err instanceof ConflictException) {
        this.metrics.cycles.inc({ status: 'halted' });
        return;
      }
      this.metrics.cycles.inc({ status: 'error' });
      this.logger.error(`LegAutoDriver tick failed: ${this.errorMessage(err)}`);
    } finally {
      this.isRunning = false;
      this.metrics.latency.observe(Date.now() - start);
    }
  }

  private async drivePendingLegs(): Promise<void> {
    // Find created legs for executing plans. We then filter to live-venue legs in memory
    // (Р2-4) because venueKey lives in plan.playbookConfig.legs[legIndex], not on the leg row.
    const createdLegs = await this.legsRepo.find({
      where: { state: 'created' },
      take: 20,
      order: { createdAt: 'ASC' },
    });
    if (createdLegs.length === 0) {
      return;
    }

    // Group by plan to drive each plan's legs sequentially (Р2-3).
    const byPlan = new Map<string, ExecutionLegEntity[]>();
    for (const leg of createdLegs) {
      const bucket = byPlan.get(leg.planId);
      if (bucket !== undefined) {
        bucket.push(leg);
      } else {
        byPlan.set(leg.planId, [leg]);
      }
    }

    for (const [planId, legs] of byPlan) {
      try {
        await this.drivePlanLegs(planId, legs);
      } catch (err) {
        this.logger.warn(`Plan ${planId} leg-drive failed: ${this.errorMessage(err)}`);
      }
    }
  }

  private async drivePlanLegs(planId: string, legs: ExecutionLegEntity[]): Promise<void> {
    const plan = await this.plansRepo.findOne({ where: { id: planId } });
    if (plan === null || plan.state !== 'executing') {
      return;
    }
    const playbookConfig = plan.playbookConfig as
      | { legs?: Array<{ venueKey?: string }> }
      | undefined;
    const cfgLegs = playbookConfig?.legs ?? [];

    // Р2-3: sort by legIndex and process sequentially.
    const sorted = [...legs].sort((a, b) => a.legIndex - b.legIndex);
    for (const leg of sorted) {
      // Р2-4: live-only filter. venueKey comes from playbookConfig.legs[legIndex].
      const venueKey = cfgLegs[leg.legIndex]?.venueKey;
      if (venueKey === undefined || !isLiveVenueKey(venueKey)) {
        // Paper leg (e.g. paper-dex) — leave to manual/other path. Do not auto-drive.
        this.metrics.legsProcessed.inc({ outcome: 'skip_paper_venue' });
        continue;
      }

      // Re-check kill-switch per leg (operator may halt mid-plan).
      try {
        await this.killSwitch.assertLiveNotHalted();
      } catch (err) {
        if (err instanceof ConflictException) {
          this.metrics.cycles.inc({ status: 'halted' });
          this.metrics.legsProcessed.inc({ outcome: 'skip_halted' });
          return; // halt stops the whole tick; remaining legs retry next tick
        }
        throw err;
      }

      try {
        // Bound the markSent call: it performs the on-chain broadcast + receipt
        // wait, which previously could hang the whole worker (isRunning guard).
        // On timeout the leg stays `submitting` and the reaper reconciles it.
        let markSentTimer: ReturnType<typeof setTimeout> | undefined;
        const markSentTimeout = new Promise<never>((_, reject) => {
          markSentTimer = setTimeout(
            () => reject(new Error('markSent timeout')),
            this.markSentTimeoutMs(),
          );
        });
        try {
          await Promise.race([
            this.legs.markSent(planId, leg.id),
            markSentTimeout,
          ]);
        } finally {
          if (markSentTimer !== undefined) {
            clearTimeout(markSentTimer);
          }
        }
      } catch (err) {
        // markSent timeout: leg stays submitting; reaper (P9-7) recovers. Do NOT
        // treat this as a 422/503 — the broadcast may still land on-chain.
        if (err instanceof Error && err.message === 'markSent timeout') {
          this.metrics.legsProcessed.inc({ outcome: 'mark_sent_timeout' });
          this.logger.warn(
            `markSent timeout for leg ${leg.id} — leg stays submitting, reaper will recover`,
          );
          continue;
        }
        // 503 transient: leg stays submitting; reaper reconciles. 422: leg failed.
        const status = this.httpStatus(err);
        if (status === 503) {
          this.metrics.legsProcessed.inc({ outcome: 'skip_transient' });
          continue;
        }
        this.metrics.legsProcessed.inc({ outcome: 'mark_sent_failed' });
        this.logger.warn(
          `Leg ${leg.id} markSent failed (status=${status}): ${this.errorMessage(err)}`,
        );
        continue;
      }

      // Р2-1: re-check leg state after markSent. If still `submitting` (tx pending/timeout),
      // do NOT call markAcknowledged — it requires strictly `sent` (legs.service.ts:688-691)
      // and would throw ConflictException. Skip; stuck-plan-reaper or next tick reconciles.
      const refreshed = await this.legsRepo.findOne({ where: { id: leg.id } });
      if (refreshed === null || refreshed.state === 'submitting') {
        this.metrics.legsProcessed.inc({ outcome: 'skip_submitting' });
        continue;
      }
      if (refreshed.state !== 'sent') {
        this.metrics.legsProcessed.inc({ outcome: `unexpected_state_${refreshed.state}` });
        continue;
      }

      try {
        await this.legs.markAcknowledged(planId, leg.id);
        await this.legs.applyFill(planId, leg.id, {
          mode: 'full',
          idempotencyKey: `leg-auto-driver:${leg.id}:${randomUUID()}`,
        });
        this.metrics.legsProcessed.inc({ outcome: 'filled' });
      } catch (err) {
        // Р2-5: sell leg may revert if pre-quoted amountIn exceeded actual received balance.
        // This is a terminal failure → manual recovery. Log prominently.
        this.metrics.legsProcessed.inc({ outcome: 'fill_failed' });
        this.logger.error(
          `Leg ${leg.id} (plan ${planId}) ack/fill failed: ${this.errorMessage(err)}. If sell leg, possible reverted-sell (Модель #1 risk) → manual recovery.`,
        );
        continue;
      }
    }

    // Try to mark plan completed if all legs filled.
    try {
      await this.plans.tryMarkPlanCompletedWhenAllLegsFilled(planId);
      this.metrics.plansCompleted.inc({ outcome: 'attempted' });
    } catch (err) {
      this.logger.warn(
        `Plan ${planId} completion check failed: ${this.errorMessage(err)}`,
      );
    }
  }

  private httpStatus(err: unknown): number | undefined {
    if (typeof err === 'object' && err !== null && 'status' in err) {
      const s = (err as { status?: unknown }).status;
      return typeof s === 'number' ? s : undefined;
    }
    return undefined;
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
