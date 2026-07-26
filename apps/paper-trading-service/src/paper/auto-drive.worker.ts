import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Counter, Histogram } from 'prom-client';

import { PaperPromotionCandidateEntity, PaperTradeEntity } from '@arbibot/persistence';

import { AutoDriveConfigService } from './auto-drive-config.service';
import { PaperTradesService } from './paper-trades.service';

/**
 * AutoDriveWorker (PAD-3) — automated post-promotion pipeline for paper trades.
 *
 * Drives ONLY the post-operator-approval chain. Promotion (queued → under_review → promoted)
 * stays an explicit operator action because it is the paper→live gate (paper-live-boundary.md).
 *
 * Per tick (every PAPER_AUTO_DRIVE_INTERVAL_MS), three phases run in order:
 *   A. promoted candidates → draft paper_trades (skip if draft already exists for the candidate;
 *      idempotency_key = `auto-drive:${candidate.id}`). Filtered by minNetProfitUsd.
 *   B. (opt-in, PAPER_AUTO_APPROVE) draft → active via PaperTradesService.approve. Skipped entirely
 *      while active trades ≥ maxConcurrentTrades (capital gate).
 *   C. active → settled via PaperTradesService.settle once the trade has aged past
 *      PAPER_AUTO_SETTLE_DELAY_MS. P/L sourced from the summary block written in phase A
 *      (which carried the opportunity P/L through the v1.1 promotion-candidate contract).
 *
 * Kill-switch: `paper.auto_drive.enabled = false` (config-service) or env PAPER_AUTO_DRIVE_ENABLED=false
 * halts the worker. `tools/panic-button.sh` flips the env to false.
 *
 * Re-entrancy / anti-loop:
 *  - isRunning guard prevents overlapping ticks (one tick at a time).
 *  - Phase A is idempotent: candidate→draft uses idempotency_key; second tick finds the draft and skips.
 *  - Phase C calls settle() which is itself idempotent (already-settled returns the row).
 */
@Injectable()
export class AutoDriveWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoDriveWorker.name);
  private isRunning = false;
  private isShuttingDown = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  private readonly metrics = (() => {
    const reg = getArbibotMetricsRegistry();
    return {
      cycles: new Counter({
        name: 'arb_paper_auto_drive_cycles_total',
        help: 'AutoDriveWorker cycles (labels: success/error/disabled)',
        labelNames: ['status'],
        registers: [reg],
      }),
      promotedToDraft: new Counter({
        name: 'arb_paper_auto_drive_promoted_to_draft_total',
        help: 'Promoted candidates turned into draft paper trades (labels: outcome)',
        labelNames: ['outcome'],
        registers: [reg],
      }),
      approved: new Counter({
        name: 'arb_paper_auto_drive_approved_total',
        help: 'Draft paper trades auto-approved to active (labels: outcome)',
        labelNames: ['outcome'],
        registers: [reg],
      }),
      settled: new Counter({
        name: 'arb_paper_auto_drive_settled_total',
        help: 'Active paper trades auto-settled (labels: outcome)',
        labelNames: ['outcome'],
        registers: [reg],
      }),
      profit: new Histogram({
        name: 'arb_paper_auto_drive_profit_usd',
        help: 'Realized paper P/L (USD) recorded at auto-settle',
        buckets: [-50, -10, -1, 0, 1, 10, 50, 100, 500],
        registers: [reg],
      }),
      latency: new Histogram({
        name: 'arb_paper_auto_drive_latency_ms',
        help: 'AutoDriveWorker tick latency in milliseconds',
        buckets: [10, 50, 100, 250, 500, 1000, 5000],
        registers: [reg],
      }),
    };
  })();

  constructor(
    private readonly configService: AutoDriveConfigService,
    private readonly paperTradesService: PaperTradesService,
    @InjectRepository(PaperPromotionCandidateEntity)
    private readonly candidatesRepo: Repository<PaperPromotionCandidateEntity>,
    @InjectRepository(PaperTradeEntity)
    private readonly tradesRepo: Repository<PaperTradeEntity>,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.configService.getConfig().intervalMs;
    // Even if disabled at startup, register the timer — config-service may flip enabled=true later.
    this.logger.log(`Starting AutoDriveWorker (interval=${intervalMs}ms)`);
    void this.runCycle('startup').catch((err) => {
      this.logger.warn(`Initial AutoDrive cycle failed: ${this.errorMessage(err)}`);
    });
    this.intervalHandle = setInterval(() => {
      void this.runCycle('interval');
    }, intervalMs);
    this.intervalHandle.unref?.();
  }

  onModuleDestroy(): void {
    this.isShuttingDown = true;
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.logger.log('AutoDriveWorker stopped');
  }

  /**
   * Manual trigger (admin endpoint). Returns a summary of the cycle.
   */
  async trigger(): Promise<{
    ran: boolean;
    draftsCreated: number;
    approved: number;
    settled: number;
    message: string;
  }> {
    if (this.isRunning) {
      return { ran: false, draftsCreated: 0, approved: 0, settled: 0, message: 'cycle already running' };
    }
    const result = await this.runCycleInner('manual').catch((err) => {
      throw err;
    });
    return {
      ran: true,
      draftsCreated: result.draftsCreated,
      approved: result.approved,
      settled: result.settled,
      message: `cycle complete (drafts=${result.draftsCreated}, approved=${result.approved}, settled=${result.settled})`,
    };
  }

  private async runCycle(reason: 'startup' | 'interval' | 'manual'): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.debug(`Skipping AutoDrive cycle (${reason}) — shutting down`);
      return;
    }
    if (this.isRunning) {
      this.logger.warn(`AutoDrive cycle already running (${reason}) — skipping`);
      return;
    }
    // Refresh config (TTL pull from config-service); never throws.
    await this.configService.ensureEffectiveConfigLoaded();
    if (!this.configService.isEnabled()) {
      this.metrics.cycles.inc({ status: 'disabled' });
      return;
    }
    this.isRunning = true;
    const startedAt = Date.now();
    try {
      await this.runCycleInner(reason);
      const elapsedMs = Date.now() - startedAt;
      this.metrics.latency.observe(elapsedMs);
      this.metrics.cycles.inc({ status: 'success' });
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      const error = this.errorMessage(err);
      this.metrics.latency.observe(elapsedMs);
      this.metrics.cycles.inc({ status: 'error' });
      this.logger.error(`AutoDrive cycle (${reason}) failed in ${elapsedMs}ms: ${error}`);
      // Do not re-throw: a failed tick must not crash the timer.
    } finally {
      this.isRunning = false;
    }
  }

  private async runCycleInner(
    _reason: 'startup' | 'interval' | 'manual',
  ): Promise<{ draftsCreated: number; approved: number; settled: number }> {
    const cfg = this.configService.getConfig();
    const batch = cfg.batchSize;

    // --- Phase A: promoted candidates → draft paper_trades ---
    const promoted = await this.candidatesRepo.find({
      where: { status: 'promoted' as const },
      take: batch,
      order: { updatedAt: 'ASC' },
    });
    let draftsCreated = 0;
    for (const candidate of promoted) {
      // Idempotency: a paper trade created from this candidate already exists.
      const idempotencyKey = `auto-drive:${candidate.id}`;
      const existing = await this.tradesRepo.findOne({ where: { idempotencyKey } });
      if (existing !== null) {
        this.metrics.promotedToDraft.inc({ outcome: 'skipped_exists' });
        continue;
      }
      const pl = extractProfitLoss(candidate);
      if (pl.netProfitUsd !== null && pl.netProfitUsd < cfg.minNetProfitUsd) {
        this.metrics.promotedToDraft.inc({ outcome: 'skipped_min_profit' });
        continue;
      }
      try {
        await this.paperTradesService.create({
          opportunityId: candidate.opportunityId ?? undefined,
          instrumentKey: candidate.instrumentKey,
          notional: String(cfg.notionalUsd),
          summary: {
            autoDriveCandidateId: candidate.id,
            ...(pl.netProfitUsd !== null ? { netProfitUsd: pl.netProfitUsd } : {}),
            ...(pl.spreadBps !== null ? { spreadBps: pl.spreadBps } : {}),
            ...(pl.buyVenue !== null ? { buyVenue: pl.buyVenue } : {}),
            ...(pl.sellVenue !== null ? { sellVenue: pl.sellVenue } : {}),
            ...(pl.buyPrice !== null ? { buyPrice: pl.buyPrice } : {}),
            ...(pl.sellPrice !== null ? { sellPrice: pl.sellPrice } : {}),
          },
          idempotencyKey,
        });
        draftsCreated += 1;
        this.metrics.promotedToDraft.inc({ outcome: 'created' });
      } catch (err) {
        this.metrics.promotedToDraft.inc({ outcome: 'failed' });
        this.logger.warn(
          `Phase A: failed to create draft from candidate ${candidate.id}: ${this.errorMessage(err)}`,
        );
      }
    }

    // --- Phase B (opt-in): draft → active ---
    let approved = 0;
    if (cfg.autoApprove) {
      const activeCount = await this.tradesRepo.count({ where: { state: 'active' as const } });
      if (activeCount >= cfg.maxConcurrentTrades) {
        this.metrics.approved.inc({ outcome: 'skipped_max_concurrent' });
      } else {
        const drafts = await this.tradesRepo.find({
          where: { state: 'draft' as const },
          take: batch,
          order: { updatedAt: 'ASC' },
        });
        let headroom = cfg.maxConcurrentTrades - activeCount;
        for (const draft of drafts) {
          if (headroom <= 0) {
            this.metrics.approved.inc({ outcome: 'skipped_max_concurrent' });
            break;
          }
          try {
            await this.paperTradesService.approve(draft.id, 'auto-driver');
            approved += 1;
            headroom -= 1;
            this.metrics.approved.inc({ outcome: 'approved' });
          } catch (err) {
            this.metrics.approved.inc({ outcome: 'failed' });
            this.logger.warn(
              `Phase B: failed to approve draft ${draft.id}: ${this.errorMessage(err)}`,
            );
          }
        }
      }
    }

    // --- Phase C: active (aged) → settled ---
    const now = Date.now();
    const actives = await this.tradesRepo.find({
      where: { state: 'active' as const },
      take: batch,
      order: { updatedAt: 'ASC' },
    });
    let settledCount = 0;
    for (const trade of actives) {
      const ageMs = now - trade.updatedAt.getTime();
      if (ageMs < cfg.autoSettleDelayMs) {
        this.metrics.settled.inc({ outcome: 'skipped_delay' });
        continue;
      }
      const summary =
        trade.summary && typeof trade.summary === 'object'
          ? (trade.summary)
          : {};
      const buyPrice = readNumber(summary, 'buyPrice');
      const sellPrice = readNumber(summary, 'sellPrice');
      const netProfitUsd = readNumber(summary, 'netProfitUsd');
      const spreadBps = readNumber(summary, 'spreadBps');
      // Fall back to 0 when summary lacks P/L (e.g. manual draft without opportunity P/L).
      const entry = buyPrice ?? 0;
      const exit = sellPrice ?? buyPrice ?? 0;
      const profit = netProfitUsd ?? 0;
      try {
        const result = await this.paperTradesService.settle(
          trade.id,
          {
            entryPrice: entry,
            exitPrice: exit,
            profitUsd: profit,
            expectedVersion: trade.entityVersion,
            ...(spreadBps !== null ? { spreadBps } : {}),
          },
          'auto-driver',
        );
        // Idempotent settle returns the existing settled row — only count newly settled.
        if (result.state === 'settled' && trade.state !== 'settled') {
          settledCount += 1;
          this.metrics.settled.inc({ outcome: 'settled' });
          this.metrics.profit.observe(profit);
        } else {
          this.metrics.settled.inc({ outcome: 'settle_already_settled' });
        }
      } catch (err) {
        this.metrics.settled.inc({ outcome: 'failed' });
        this.logger.warn(
          `Phase C: failed to settle active trade ${trade.id}: ${this.errorMessage(err)}`,
        );
      }
    }

    if (draftsCreated > 0 || approved > 0 || settledCount > 0) {
      this.logger.log(
        `AutoDrive cycle (${_reason}): drafts=${draftsCreated} approved=${approved} settled=${settledCount}`,
      );
    }
    return { draftsCreated, approved, settled: settledCount };
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Extract AutoDrive P/L fields from a promotion candidate's evidence jsonb. */
function extractProfitLoss(candidate: PaperPromotionCandidateEntity): {
  netProfitUsd: number | null;
  spreadBps: number | null;
  buyVenue: string | null;
  sellVenue: string | null;
  buyPrice: number | null;
  sellPrice: number | null;
} {
  const evidence =
    candidate.evidence && typeof candidate.evidence === 'object'
      ? (candidate.evidence)
      : {};
  return {
    netProfitUsd: readNumber(evidence, 'netProfitUsd'),
    spreadBps: readNumber(evidence, 'spreadBps'),
    buyVenue: readString(evidence, 'buyVenue'),
    sellVenue: readString(evidence, 'sellVenue'),
    buyPrice: readNumber(evidence, 'buyPrice'),
    sellPrice: readNumber(evidence, 'sellPrice'),
  };
}

function readNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function readString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}
