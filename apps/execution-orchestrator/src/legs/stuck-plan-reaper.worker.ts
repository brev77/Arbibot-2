import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ExecutionLegEntity, ExecutionPlanEntity } from '@arbibot/persistence';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Counter } from 'prom-client';

/**
 * Stuck-Plan Reaper Worker (P9-7).
 *
 * Detects legs stuck in non-terminal states and plans stuck in non-terminal
 * execution states, then reconciles them. This is the recovery path for the
 * two-phase mark-sent (P9-1): if the process crashes between Phase 1 commit
 * (leg → `submitting`) and Phase 3 commit (leg → `sent`), the leg is left in
 * `submitting` with no one to advance it. The reaper:
 *
 *   1. Finds legs in `submitting` older than LEG_STUCK_TIMEOUT_MS (default 5 min).
 *   2. For each, checks whether an OnChainTransaction row exists (P9-2 wrote it
 *      in Phase 3 if the process survived to commit). If a confirmed row exists
 *      but the leg is still `submitting`, the reaper flips the leg to `sent`
 *      (the broadcast succeeded; only Phase 3 failed).
 *   3. If no OnChainTransaction row exists (crash before Phase 3), the reaper
 *      cannot know whether the tx was broadcast. It flips the leg to `failed`
 *      (terminal) — capital release is then handled by the settlement-relay
 *      (P9-8) over HTTP to capital-service (single-writer boundary, guard BV1).
 *      An operator can manually re-arm the plan if the tx later appears on-chain.
 *
 * Also detects plans stuck in `armed`/`executing` older than
 * PLAN_STUCK_TIMEOUT_MS (default 30 min) — surfaced as an alert metric only
 * (no automatic terminal transition for plans; an operator investigates).
 *
 * Boundary (guard BV1): this worker ONLY writes to ExecutionLeg/ExecutionPlan
 * (owned by execution-orchestrator). It does NOT touch capital_reservations —
 * capital release goes through the existing settlement HTTP path (P9-8 relay).
 */
@Injectable()
export class StuckPlanReaperWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StuckPlanReaperWorker.name);
  private isRunning = false;
  private isShuttingDown = false;
  private reaperInterval: ReturnType<typeof setInterval> | null = null;

  private readonly stuckLegCounter: Counter;
  private readonly stuckPlanCounter: Counter;
  private readonly recoveredLegCounter: Counter;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ExecutionLegEntity)
    private readonly legsRepo: Repository<ExecutionLegEntity>,
  ) {
    const registry = getArbibotMetricsRegistry();
    const legMetric = 'arb_execution_stuck_leg_detected_total';
    this.stuckLegCounter =
      registry.getSingleMetric(legMetric) instanceof Counter
        ? (registry.getSingleMetric(legMetric) as Counter)
        : new Counter({
            name: legMetric,
            help: 'Legs detected as stuck in a non-terminal state (P9-7)',
            labelNames: ['state', 'outcome'],
            registers: [registry],
          });
    const planMetric = 'arb_execution_stuck_plan_detected_total';
    this.stuckPlanCounter =
      registry.getSingleMetric(planMetric) instanceof Counter
        ? (registry.getSingleMetric(planMetric) as Counter)
        : new Counter({
            name: planMetric,
            help: 'Plans detected as stuck in armed/executing (P9-7)',
            labelNames: ['state'],
            registers: [registry],
          });
    const recoveredMetric = 'arb_execution_stuck_leg_recovered_total';
    this.recoveredLegCounter =
      registry.getSingleMetric(recoveredMetric) instanceof Counter
        ? (registry.getSingleMetric(recoveredMetric) as Counter)
        : new Counter({
            name: recoveredMetric,
            help: 'Stuck legs recovered by the reaper (P9-7)',
            labelNames: ['outcome'],
            registers: [registry],
          });
  }

  onModuleInit(): void {
    const enabled = process.env.STUCK_REAPER_ENABLED !== 'false';
    if (!enabled) {
      this.logger.log('Stuck-plan reaper disabled (STUCK_REAPER_ENABLED=false)');
      return;
    }
    const intervalMs = Number(process.env.STUCK_REAPER_INTERVAL_MS ?? 60_000);
    this.logger.log(`Starting stuck-plan reaper (interval ${intervalMs}ms)`);
    this.reaperInterval = setInterval(() => {
      void this.runCycle();
    }, intervalMs);
    this.reaperInterval.unref?.();
  }

  onModuleDestroy(): void {
    this.isShuttingDown = true;
    if (this.reaperInterval !== null) {
      clearInterval(this.reaperInterval);
      this.reaperInterval = null;
    }
    this.logger.log('Stuck-plan reaper shutting down');
  }

  async runCycle(): Promise<{ legsRecovered: number; legsFailed: number; plansStuck: number }> {
    if (this.isRunning || this.isShuttingDown) {
      return { legsRecovered: 0, legsFailed: 0, plansStuck: 0 };
    }
    this.isRunning = true;
    let legsRecovered = 0;
    let legsFailed = 0;
    let plansStuck = 0;
    try {
      const legTimeoutMs = Number(process.env.LEG_STUCK_TIMEOUT_MS ?? 300_000);
      const planTimeoutMs = Number(process.env.PLAN_STUCK_TIMEOUT_MS ?? 1_800_000);
      const cutoff = new Date(Date.now() - legTimeoutMs);

      // 1. Reap stuck `submitting` legs.
      const stuckLegs = await this.legsRepo.find({
        where: { state: 'submitting' as ExecutionLegEntity['state'] },
        take: 50,
        order: { createdAt: 'ASC' },
      });
      for (const leg of stuckLegs) {
        if (leg.updatedAt >= cutoff) {
          continue; // not old enough yet
        }
        const outcome = await this.reapStuckLeg(leg);
        if (outcome === 'recovered') {
          legsRecovered += 1;
        } else {
          legsFailed += 1;
        }
      }

      // 2. Surface stuck plans (alert-only, no auto-transition).
      const planCutoff = new Date(Date.now() - planTimeoutMs);
      const stuckPlans = await this.dataSource
        .getRepository(ExecutionPlanEntity)
        .createQueryBuilder('plan')
        .where('plan.state IN (:...states)', { states: ['armed', 'executing'] })
        .andWhere('plan.updatedAt < :cutoff', { cutoff: planCutoff })
        .getCount();
      if (stuckPlans > 0) {
        this.stuckPlanCounter.inc({ state: 'armed_or_executing' }, stuckPlans);
        this.logger.warn(
          `${stuckPlans} plan(s) stuck in armed/executing for >${planTimeoutMs}ms — operator investigation required`,
        );
        plansStuck = stuckPlans;
      }
      return { legsRecovered, legsFailed, plansStuck };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Stuck-plan reaper cycle failed: ${msg}`);
      return { legsRecovered, legsFailed, plansStuck };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Reconcile a single stuck `submitting` leg.
   * - If a confirmed OnChainTransaction exists for this leg → flip to `sent`
   *   (broadcast succeeded, only Phase 3 commit was lost).
   * - Otherwise → flip to `failed` (crash before Phase 3; tx status unknown).
   *   Capital release is handled by the settlement relay (P9-8) over HTTP.
   */
  private async reapStuckLeg(leg: ExecutionLegEntity): Promise<'recovered' | 'failed'> {
    try {
      const result = await this.dataSource.transaction(async (em) => {
        // Re-lock the leg; it may have advanced since the find.
        const fresh = await em.findOne(ExecutionLegEntity, {
          where: { id: leg.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (fresh === null || fresh.state !== 'submitting') {
          return 'already-advanced' as const;
        }
        // Check for a confirmed on-chain tx (P9-2 row written in Phase 3).
        // Note: `venue_ref` lives on execution_legs, NOT on on_chain_transactions —
        // the previous SELECT referenced a column that does not exist on this table
        // (fix #11). The query ran but threw every tick, masking the recovery path;
        // legs stayed stuck in `submitting` until the reaper silently errored out.
        const confirmedTx = await em.query(
          `SELECT id, tx_hash FROM on_chain_transactions
           WHERE leg_id = $1 AND status = 'confirmed'
           ORDER BY created_at DESC LIMIT 1`,
          [leg.id],
        );
        if (Array.isArray(confirmedTx) && confirmedTx.length > 0) {
          // Phase 3 partially committed (OnChainTransaction written) but the leg
          // transition rolled back → recover: flip to `sent`.
          fresh.state = 'sent';
          fresh.entityVersion += 1;
          if (fresh.venueRef === null || fresh.venueRef.length === 0) {
            fresh.venueRef = confirmedTx[0]!.tx_hash;
          }
          await em.save(fresh);
          return 'recovered' as const;
        }
        // No confirmed tx → crash before Phase 3. Tx status unknown. Mark
        // `failed` (terminal); capital release via settlement relay (P9-8).
        fresh.state = 'failed';
        fresh.entityVersion += 1;
        await em.save(fresh);
        return 'failed' as const;
      });
      if (result === 'recovered') {
        this.stuckLegCounter.inc({ state: 'submitting', outcome: 'recovered' });
        this.recoveredLegCounter.inc({ outcome: 'recovered' });
        this.logger.log(`Reaper recovered stuck submitting leg ${leg.id} → sent (confirmed on-chain tx found)`);
        return 'recovered';
      }
      if (result === 'failed') {
        this.stuckLegCounter.inc({ state: 'submitting', outcome: 'failed' });
        this.recoveredLegCounter.inc({ outcome: 'failed' });
        this.logger.warn(
          `Reaper marked stuck submitting leg ${leg.id} → failed (no confirmed on-chain tx; capital release via settlement relay). ` +
            `If the tx later appears on-chain, an operator may manually re-arm.`,
        );
        return 'failed';
      }
      return 'failed'; // already-advanced — no metric
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Reaper failed to reconcile stuck leg ${leg.id}: ${msg}`);
      return 'failed';
    }
  }
}
