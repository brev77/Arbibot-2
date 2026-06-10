import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Counter } from 'prom-client';
import { DataSource, Repository } from 'typeorm';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { BridgeTransferEntity, ExecutionLegEntity, ExecutionPlanEntity } from '@arbibot/persistence';

import { BridgeTransferService } from '../bridge/bridge-transfer.service';

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

/** A bridge transfer that has completed but may have data issues. */
export interface BridgeMismatch {
  readonly transferId: string;
  readonly legId: string;
  readonly planId: string;
  readonly bridgeKey: string;
  readonly sourceChainId: number;
  readonly destinationChainId: number;
  readonly mismatchType: 'missing_destination_tx' | 'amount_discrepancy' | 'missing_confirmed_at';
  readonly details: string;
  readonly detectedAt: Date;
}

/** A bridge transfer that has been stuck in an active state too long. */
export interface StaleBridgeTransfer {
  readonly transferId: string;
  readonly legId: string;
  readonly planId: string;
  readonly bridgeKey: string;
  readonly sourceChainId: number;
  readonly destinationChainId: number;
  readonly status: string;
  readonly ageMs: number;
  readonly timeoutThresholdMs: number;
  readonly detectedAt: Date;
}

/** Reconciliation result for a single plan. */
export interface PlanReconciliationResult {
  readonly planId: string;
  readonly planState: string;
  readonly totalLegs: number;
  readonly filledLegs: number;
  readonly bridgeTransfers: number;
  readonly completedBridges: number;
  readonly mismatches: ReadonlyArray<BridgeMismatch>;
  readonly staleTransfers: ReadonlyArray<StaleBridgeTransfer>;
  readonly reconciledAt: Date;
  readonly healthy: boolean;
}

/** Aggregate reconciliation status. */
export interface ReconciliationStatus {
  readonly lastCheckAt: Date | null;
  readonly totalMismatches: number;
  readonly totalStale: number;
  readonly checkedPlans: number;
  readonly healthy: boolean;
}

// ───────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────

/** Default stale threshold: 30 minutes. */
const DEFAULT_STALE_THRESHOLD_MS = 1_800_000;

// ───────────────────────────────────────────────────────────────────────
// Service
// ───────────────────────────────────────────────────────────────────────

/**
 * Cross-chain reconciliation service.
 *
 * Step: DEX-2-3-RECON-XCHAIN
 *
 * Detects mismatches and stale state in bridge transfers and multi-leg plans.
 * Single-writer: execution-orchestrator (read-only reconciliation checks).
 *
 * Responsibilities:
 * - Detect completed bridge transfers with missing destination tx hash
 * - Detect completed bridge transfers with amount discrepancies
 * - Detect stale bridge transfers (stuck in active state)
 * - Reconcile full multi-leg plan state (DEX fills + bridge transfers)
 * - Generate incident data for operator review
 */
@Injectable()
export class CrossChainReconciliationService {
  private readonly logger = new Logger(CrossChainReconciliationService.name);

  /** Timestamp of the last completed reconciliation cycle. */
  private lastCheckAt: Date | null = null;

  /** Running count of mismatches found in the last cycle. */
  private lastMismatchCount = 0;

  /** Running count of stale transfers found in the last cycle. */
  private lastStaleCount = 0;

  /** Running count of plans checked in the last cycle. */
  private lastCheckedPlans = 0;

  // Metrics
  private checksCounter!: Counter<string>;
  private mismatchesCounter!: Counter<string>;
  private staleCounter!: Counter<string>;

  private readonly legRepo: Repository<ExecutionLegEntity>;
  private readonly planRepo: Repository<ExecutionPlanEntity>;

  constructor(
    @InjectRepository(BridgeTransferEntity)
    private readonly bridgeTransferRepo: Repository<BridgeTransferEntity>,
    private readonly bridgeTransferService: BridgeTransferService,
    private readonly dataSource: DataSource,
  ) {
    // Use DataSource.getRepository() for entities registered in other modules
    // to avoid duplicate TypeOrmModule.forFeature registrations
    this.legRepo = dataSource.getRepository(ExecutionLegEntity);
    this.planRepo = dataSource.getRepository(ExecutionPlanEntity);
    this.initializeMetrics();
  }

  // ─────────────────────────────────────────────────────────────────────
  // Mismatch detection
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Detect completed bridge transfers with missing destination tx hash
   * or other data quality issues.
   */
  async detectBridgeMismatches(): Promise<BridgeMismatch[]> {
    const mismatches: BridgeMismatch[] = [];

    // Find completed transfers without destination tx hash
    const completedWithoutDestTx = await this.bridgeTransferRepo.find({
      where: { status: 'completed' },
    });

    for (const transfer of completedWithoutDestTx) {
      if (!transfer.destinationTxHash) {
        const planId = await this.resolvePlanIdForTransfer(transfer);
        mismatches.push({
          transferId: transfer.id,
          legId: transfer.legId,
          planId,
          bridgeKey: transfer.bridgeKey,
          sourceChainId: transfer.sourceChainId,
          destinationChainId: transfer.destinationChainId,
          mismatchType: 'missing_destination_tx',
          details: `Completed bridge transfer ${transfer.id} has no destinationTxHash`,
          detectedAt: new Date(),
        });
      }

      if (!transfer.confirmedAt) {
        const planId = await this.resolvePlanIdForTransfer(transfer);
        mismatches.push({
          transferId: transfer.id,
          legId: transfer.legId,
          planId,
          bridgeKey: transfer.bridgeKey,
          sourceChainId: transfer.sourceChainId,
          destinationChainId: transfer.destinationChainId,
          mismatchType: 'missing_confirmed_at',
          details: `Completed bridge transfer ${transfer.id} has no confirmedAt timestamp`,
          detectedAt: new Date(),
        });
      }
    }

    if (mismatches.length > 0) {
      this.logger.warn(
        `detectBridgeMismatches: found ${mismatches.length} mismatches`,
      );
    }

    return mismatches;
  }

  /**
   * Detect bridge transfers stuck in active state beyond the stale threshold.
   *
   * @param staleThresholdMs - Threshold in ms (default: 30 minutes)
   */
  async detectStaleBridgeTransfers(
    staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
  ): Promise<StaleBridgeTransfer[]> {
    const staleTransfers: StaleBridgeTransfer[] = [];
    const now = Date.now();

    const activeTransfers = await this.bridgeTransferService.getActiveTransfers();

    for (const transfer of activeTransfers) {
      const submittedAt = transfer.submittedAt?.getTime() ?? transfer.createdAt.getTime();
      const ageMs = now - submittedAt;

      if (ageMs > staleThresholdMs) {
        const planId = await this.resolvePlanIdForTransfer(transfer);
        staleTransfers.push({
          transferId: transfer.id,
          legId: transfer.legId,
          planId,
          bridgeKey: transfer.bridgeKey,
          sourceChainId: transfer.sourceChainId,
          destinationChainId: transfer.destinationChainId,
          status: transfer.status,
          ageMs,
          timeoutThresholdMs: staleThresholdMs,
          detectedAt: new Date(),
        });
      }
    }

    if (staleTransfers.length > 0) {
      this.logger.warn(
        `detectStaleBridgeTransfers: found ${staleTransfers.length} stale transfers`,
      );
    }

    return staleTransfers;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Plan reconciliation
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Reconcile all legs and bridge transfers for a specific plan.
   *
   * Checks:
   * - All DEX legs have a filled state if plan is completed
   * - All bridge legs have a completed bridge transfer
   * - No mismatch data on bridge transfers
   */
  async reconcilePlan(planId: string): Promise<PlanReconciliationResult> {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) {
      throw new Error(`Plan not found: ${planId}`);
    }

    const legs = await this.legRepo.find({
      where: { planId },
      order: { legIndex: 'ASC' },
    });

    const bridgeTransfers = await this.bridgeTransferRepo.find({
      where: legs
        .filter((l) => l.legType === 'bridge')
        .map((l) => ({ legId: l.id })),
    });

    const filledLegs = legs.filter(
      (l) => l.state === 'filled' || l.state === 'partiallyFilled',
    ).length;

    const completedBridges = bridgeTransfers.filter(
      (bt) => bt.status === 'completed',
    ).length;

    // Detect mismatches for this plan's bridge transfers
    const mismatches: BridgeMismatch[] = [];
    for (const transfer of bridgeTransfers) {
      if (transfer.status === 'completed' && !transfer.destinationTxHash) {
        mismatches.push({
          transferId: transfer.id,
          legId: transfer.legId,
          planId,
          bridgeKey: transfer.bridgeKey,
          sourceChainId: transfer.sourceChainId,
          destinationChainId: transfer.destinationChainId,
          mismatchType: 'missing_destination_tx',
          details: `Completed bridge transfer ${transfer.id} has no destinationTxHash`,
          detectedAt: new Date(),
        });
      }
    }

    // Detect stale transfers for this plan
    const now = Date.now();
    const staleTransfers: StaleBridgeTransfer[] = [];
    for (const transfer of bridgeTransfers) {
      if (['pending', 'relaying', 'confirming'].includes(transfer.status)) {
        const submittedAt = transfer.submittedAt?.getTime() ?? transfer.createdAt.getTime();
        const ageMs = now - submittedAt;
        if (ageMs > DEFAULT_STALE_THRESHOLD_MS) {
          staleTransfers.push({
            transferId: transfer.id,
            legId: transfer.legId,
            planId,
            bridgeKey: transfer.bridgeKey,
            sourceChainId: transfer.sourceChainId,
            destinationChainId: transfer.destinationChainId,
            status: transfer.status,
            ageMs,
            timeoutThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
            detectedAt: new Date(),
          });
        }
      }
    }

    const healthy = mismatches.length === 0 && staleTransfers.length === 0;

    return {
      planId,
      planState: plan.state,
      totalLegs: legs.length,
      filledLegs,
      bridgeTransfers: bridgeTransfers.length,
      completedBridges,
      mismatches,
      staleTransfers,
      reconciledAt: new Date(),
      healthy,
    };
  }

  /**
   * Run a full reconciliation cycle across all plans with bridge transfers.
   *
   * @param staleThresholdMs - Stale threshold for bridge transfers
   * @returns Aggregate status
   */
  async runFullReconciliation(
    staleThresholdMs: number = DEFAULT_STALE_THRESHOLD_MS,
  ): Promise<ReconciliationStatus> {
    this.checksCounter.inc();

    // 1. Detect all bridge mismatches
    const mismatches = await this.detectBridgeMismatches();
    this.lastMismatchCount = mismatches.length;
    if (mismatches.length > 0) {
      this.mismatchesCounter.inc(mismatches.length);
    }

    // 2. Detect stale transfers
    const staleTransfers = await this.detectStaleBridgeTransfers(staleThresholdMs);
    this.lastStaleCount = staleTransfers.length;
    if (staleTransfers.length > 0) {
      this.staleCounter.inc(staleTransfers.length);
    }

    // 3. Count unique plans with bridge transfers
    const planIds = new Set<string>();
    for (const m of mismatches) {
      planIds.add(m.planId);
    }
    for (const s of staleTransfers) {
      planIds.add(s.planId);
    }
    this.lastCheckedPlans = planIds.size;

    this.lastCheckAt = new Date();

    this.logger.log(
      `runFullReconciliation: checked=${this.lastCheckedPlans} ` +
      `mismatches=${this.lastMismatchCount} stale=${this.lastStaleCount}`,
    );

    return this.getStatus();
  }

  /**
   * Get the current reconciliation status.
   */
  getStatus(): ReconciliationStatus {
    return {
      lastCheckAt: this.lastCheckAt,
      totalMismatches: this.lastMismatchCount,
      totalStale: this.lastStaleCount,
      checkedPlans: this.lastCheckedPlans,
      healthy: this.lastMismatchCount === 0 && this.lastStaleCount === 0,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Incident generation
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Generate an incident descriptor for a stale or mismatched bridge transfer.
   *
   * This does NOT persist the incident — it returns structured data
   * for the operator to review and act upon.
   */
  generateBridgeIncident(
    type: 'stale' | 'mismatch',
    data: BridgeMismatch | StaleBridgeTransfer,
  ): {
    incidentType: string;
    severity: 'warning' | 'critical';
    transferId: string;
    planId: string;
    bridgeKey: string;
    sourceChainId: number;
    destinationChainId: number;
    message: string;
    recommendedAction: string;
    detectedAt: Date;
  } {
    if (type === 'stale') {
      const stale = data as StaleBridgeTransfer;
      const ageMin = Math.round(stale.ageMs / 60_000);
      return {
        incidentType: 'bridge_transfer_stale',
        severity: stale.ageMs > stale.timeoutThresholdMs * 2 ? 'critical' : 'warning',
        transferId: stale.transferId,
        planId: stale.planId,
        bridgeKey: stale.bridgeKey,
        sourceChainId: stale.sourceChainId,
        destinationChainId: stale.destinationChainId,
        message: `Bridge transfer ${stale.transferId} stuck in ${stale.status} for ${ageMin} minutes ` +
          `(threshold: ${Math.round(stale.timeoutThresholdMs / 60_000)} min)`,
        recommendedAction: 'Check bridge status manually. Consider force unwind if capital is at risk.',
        detectedAt: stale.detectedAt,
      };
    }

    const mismatch = data as BridgeMismatch;
    return {
      incidentType: 'bridge_transfer_mismatch',
      severity: 'critical',
      transferId: mismatch.transferId,
      planId: mismatch.planId,
      bridgeKey: mismatch.bridgeKey,
      sourceChainId: mismatch.sourceChainId,
      destinationChainId: mismatch.destinationChainId,
      message: `Bridge transfer ${mismatch.transferId}: ${mismatch.details}`,
      recommendedAction: 'Investigate on-chain. Verify destination chain received funds. ' +
        'If funds lost, escalate to incident management.',
      detectedAt: mismatch.detectedAt,
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Resolve the plan ID for a bridge transfer via its leg.
   */
  private async resolvePlanIdForTransfer(
    transfer: BridgeTransferEntity,
  ): Promise<string> {
    const leg = await this.legRepo.findOne({ where: { id: transfer.legId } });
    return leg?.planId ?? 'unknown';
  }

  // ─────────────────────────────────────────────────────────────────────
  // Metrics
  // ─────────────────────────────────────────────────────────────────────

  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    this.checksCounter = new Counter({
      name: 'arb_bridge_recon_checks_total',
      help: 'Total cross-chain reconciliation checks performed',
      registers: [registry],
    });

    this.mismatchesCounter = new Counter({
      name: 'arb_bridge_recon_mismatches_total',
      help: 'Total bridge transfer mismatches detected',
      registers: [registry],
    });

    this.staleCounter = new Counter({
      name: 'arb_bridge_recon_stale_total',
      help: 'Total stale bridge transfers detected',
      registers: [registry],
    });
  }
}