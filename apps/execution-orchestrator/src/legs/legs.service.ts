import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import {
  EVENT_NAMES,
  LEG_FILLED_PAYLOAD_SCHEMA_VERSION,
  SERVICE_IDS,
  type LegFilledPayloadV2,
} from '@arbibot/contracts';
import {
  ExecutionLegEntity,
  ExecutionLegFillIdempotencyEntity,
  ExecutionPlanEntity,
  OnChainTransaction,
  OutboxEventEntity,
} from '@arbibot/persistence';
import { AuditClientService, type IAuditClient } from '@arbibot/nest-platform';

import {
  VENUE_ADAPTER,
  VenueSubmitClientError,
  VenueSubmitTransientError,
  VenueTerminalSubmitError,
  type VenueAdapter,
  type VenueOnChainMeta,
} from '../venue/venue-adapter';
import { BridgeAdapterFactoryService, extractBridgeParams } from '../execution/bridge/bridge-adapter-factory.service';
import { BridgeTransferService } from '../execution/bridge/bridge-transfer.service';
import { DexKillSwitchService } from '../execution/risk/dex-kill-switch.service';
import { extractVenueKey, isLiveVenueKey } from '../execution/venue-factory.service';
import { OnChainTransactionService } from '../execution/on-chain-transaction.service';
import { DexOutboxEventsService } from '../execution/dex-outbox-events.service';
import type { BridgeTransferParams } from '../execution/bridge/bridge-adapter.interface';
import { MultiLegPlanBuilderService } from '../plans/multi-leg-plan-builder.service';
import { TradeCostEstimatorService } from '../cost/trade-cost-estimator.service';

function readBeginLegCount(): number {
  const raw = process.env.EXECUTION_BEGIN_LEG_COUNT?.trim() ?? '1';
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 16) {
    return 1;
  }
  return n;
}

/** Portfolio grouping key: explicit plan routeKey, else risk decision, else stable plan id. */
export function resolveInstrumentKeyForPlan(plan: ExecutionPlanEntity): string {
  const rk = plan.routeKey?.trim();
  if (rk !== undefined && rk.length > 0) {
    return rk;
  }
  if (plan.riskDecisionId !== null && plan.riskDecisionId.length > 0) {
    return `arb:risk-decision:${plan.riskDecisionId}`;
  }
  return `arb:execution-plan:${plan.id}`;
}

/**
 * D4-B-3-CEILING: read a DEX leg's `tokenIn` from the multi-leg playbook
 * (`config.legs[legIndex].tokenIn`, D4-B-2c format). Returns `null` when the
 * leg is not a priced DEX leg (bridge legs, missing config) — the caller then
 * leaves the fill notional as '0'.
 */
export function readLegTokenIn(
  playbookConfig: Record<string, unknown> | null,
  legIndex: number,
): string | null {
  if (playbookConfig === null || typeof playbookConfig !== 'object') {
    return null;
  }
  const legs = (playbookConfig as { legs?: unknown }).legs;
  if (!Array.isArray(legs)) {
    return null;
  }
  const entry = legs[legIndex];
  if (entry === null || typeof entry !== 'object') {
    return null;
  }
  const tokenIn = (entry as { tokenIn?: unknown }).tokenIn;
  return typeof tokenIn === 'string' && tokenIn.length > 0 ? tokenIn : null;
}


import type { ApplyFillDto } from './dto/apply-fill.dto';
import { executionLegPartialFillCommits } from './execution-leg-metrics';
import { FillOutboundService } from './fill-outbound.service';

function isPgUniqueViolation(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) {
    return false;
  }
  const code =
    typeof err.driverError === 'object' &&
    err.driverError !== null &&
    'code' in err.driverError
      ? String((err.driverError as { code?: string }).code)
      : '';
  return code === '23505';
}

function legView(row: ExecutionLegEntity) {
  return {
    id: row.id,
    planId: row.planId,
    legIndex: row.legIndex,
    state: row.state,
    venueRef: row.venueRef,
    targetQuantity: row.targetQuantity,
    filledQuantity: row.filledQuantity,
    entityVersion: row.entityVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function planStateView(row: ExecutionPlanEntity) {
  return {
    id: row.id,
    state: row.state,
    entityVersion: row.entityVersion,
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class LegsService {
  private readonly logger = new Logger(LegsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ExecutionPlanEntity)
    private readonly plans: Repository<ExecutionPlanEntity>,
    @InjectRepository(ExecutionLegEntity)
    private readonly legs: Repository<ExecutionLegEntity>,
    @Inject(AuditClientService) private readonly audit: IAuditClient,
    @Inject(VENUE_ADAPTER) private readonly venue: VenueAdapter,
    private readonly fillOutbound: FillOutboundService,
    private readonly bridgeAdapterFactory: BridgeAdapterFactoryService,
    private readonly bridgeTransferService: BridgeTransferService,
    private readonly killSwitch: DexKillSwitchService,
    private readonly costEstimator: TradeCostEstimatorService,
    private readonly onChainTxService: OnChainTransactionService,
    private readonly dexOutbox: DexOutboxEventsService,
  ) {}

  async listForPlan(planId: string): Promise<ReturnType<typeof legView>[]> {
    await this.assertPlanExists(planId);
    const rows = await this.legs.find({
      where: { planId },
      order: { legIndex: 'ASC' },
    });
    return rows.map((r) => legView(r));
  }

  async beginExecution(planId: string): Promise<{
    plan: ReturnType<typeof planStateView>;
    legs: ReturnType<typeof legView>[];
  }> {
    return this.dataSource.transaction(async (em) => {
      const plan = await em.findOne(ExecutionPlanEntity, {
        where: { id: planId },
        lock: { mode: 'pessimistic_write' },
      });
      if (plan === null) {
        throw new NotFoundException(`Plan not found: ${planId}`);
      }
      if (plan.state !== 'armed') {
        throw new ConflictException(
          `Plan ${planId} must be armed to begin execution (current: ${plan.state})`,
        );
      }
      const existing = await em.findOne(ExecutionLegEntity, {
        where: { planId },
      });
      if (existing !== null) {
        throw new ConflictException(
          `Plan ${planId} already has execution legs; refuse duplicate begin`,
        );
      }
      plan.state = 'executing';
      plan.entityVersion += 1;
      await em.save(plan);

      // ── Multi-leg plan (DEX-2-2-PLAN) ──────────────────────────────────
      // If the plan has a MultiLegPlaybookConfig, create legs from it
      // with proper legType, chainId, and targetQuantity per leg.
      const multiLegConfig = MultiLegPlanBuilderService.parsePlaybookConfig(
        plan.playbookConfig,
      );

      const savedLegs: ExecutionLegEntity[] = [];

      if (multiLegConfig && multiLegConfig.legs.length > 0) {
        // Multi-leg plan: create legs from playbook config
        for (const legDef of multiLegConfig.legs) {
          const leg = em.create(ExecutionLegEntity, {
            planId: plan.id,
            legIndex: legDef.legIndex,
            state: 'created',
            entityVersion: 1,
            venueRef: null,
            legType: legDef.legType,
            chainId: legDef.chainId,
            targetQuantity: legDef.targetQuantity,
            filledQuantity: 0,
          });
          savedLegs.push(await em.save(leg));
        }
      } else {
        // Legacy single-chain plan: create legs from env config
        const legCount = readBeginLegCount();
        for (let i = 0; i < legCount; i += 1) {
          const leg = em.create(ExecutionLegEntity, {
            planId: plan.id,
            legIndex: i,
            state: 'created',
            entityVersion: 1,
            venueRef: null,
            targetQuantity: 10,
            filledQuantity: 0,
          });
          savedLegs.push(await em.save(leg));
        }
      }

      // ── Pre-trade cost gate (cost-estimation) ───────────────────────────
      // Estimate the full cost breakdown (gas + slippage + pool fees + bridge
      // fees across all legs) BEFORE any leg is submitted. For LIVE plans the
      // net-profit gate blocks unprofitable execution (fail-closed: an
      // unvaluable live leg also blocks). Paper plans are never blocked here —
      // paper/live isolation is structural (venueKey), so the gate only applies
      // when a live venue/bridge leg is present.
      await this.applyPlanCostGate(plan, savedLegs, em);
      this.audit.record({
        idempotencyKey: `execution:BeginExecution:${plan.id}`,
        correlationId: plan.correlationId ?? undefined,
        actor: 'execution-orchestrator',
        action: 'BeginExecution',
        resourceType: 'ExecutionPlan',
        resourceId: plan.id,
        payload: {
          state: plan.state,
          legIds: savedLegs.map((l) => l.id),
          legCount: savedLegs.length,
        },
      });
      return {
        plan: planStateView(plan),
        legs: savedLegs.map((l) => legView(l)),
      };
    });
  }

  /**
   * Pre-trade cost gate (cost-estimation): estimate the plan's total expected
   * cost and, for LIVE plans, block unprofitable execution BEFORE the first
   * leg is submitted.
   *
   * Persists the cost breakdown on the plan (`cost_breakdown` jsonb) and per-leg
   * typed columns regardless of the decision, so blocked plans remain auditable.
   * Paper plans are never blocked — paper/live isolation is structural via
   * venueKey; we only warn.
   *
   * NOTE: the estimate runs inside `beginExecution`'s transaction (the plan is
   * pessimistic-write locked). This trades a longer lock for a single atomic
   * "estimate + persist + gate" step. Acceptable at v1 because the plan is
   * already operator-approved (armed); the gate is defense-in-depth, not the
   * primary approval.
   */
  private async applyPlanCostGate(
    plan: ExecutionPlanEntity,
    savedLegs: ExecutionLegEntity[],
    em: EntityManager,
  ): Promise<void> {
    let breakdown;
    try {
      breakdown = await this.costEstimator.estimatePlanCost(plan);
    } catch (e) {
      // Estimation itself failed unexpectedly — log and proceed without a gate
      // (do not hard-block the operator's armed plan on an estimator bug; the
      // per-leg live risk gate remains the final fail-closed check).
      this.logger.warn(
        `Cost estimation failed for plan ${plan.id}: ${e instanceof Error ? e.message : String(e)} — skipping plan-level gate`,
      );
      return;
    }

    // Persist per-leg cost columns.
    for (const leg of savedLegs) {
      const legCost = breakdown.legs.find((l) => l.legIndex === leg.legIndex);
      if (legCost === undefined) {
        continue;
      }
      leg.estimatedGasUsd = round2(legCost.gasUsd);
      leg.slippageBps = legCost.legType === 'dex' ? legCost.slippageBps : null;
      leg.poolFeeUsd = legCost.legType === 'dex' ? round2(legCost.poolFeeUsd) : null;
      leg.bridgeFeeUsd = legCost.legType === 'bridge' ? round2(legCost.bridgeFeeUsd) : null;
      leg.totalCostUsd = round2(legCost.totalCostUsd);
      leg.costConfidence = legCost.estimateConfidence;
      await em.save(leg);
    }

    // Persist plan-level breakdown.
    plan.costBreakdown = breakdown as unknown as Record<string, unknown>;
    await em.save(plan);

    // Determine if ANY leg is live (DEX live venue or bridge). Paper-only plans
    // skip the blocking gate (paper/live isolation).
    const hasLiveLeg = savedLegs.some((leg) => {
      const venueKey = extractVenueKey(plan, leg);
      return leg.legType === 'bridge' || isLiveVenueKey(venueKey);
    });
    if (!hasLiveLeg) {
      return; // Paper plan — warn only (the estimator already recorded metrics).
    }

    // Live plan: enforce the net-profit gate (fail-closed).
    const decision = await this.costEstimator.evaluatePlanGate(breakdown);
    if (!decision.allowed) {
      // Throw to roll back the transaction: plan stays 'armed' (retryable once
      // conditions improve) and the cost breakdown is NOT persisted for blocked
      // plans. The gate decision + metrics are already recorded in the estimator.
      throw new HttpException(
        `Plan ${plan.id} blocked by pre-trade cost gate: ${decision.reasons.join('; ')}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  /**
   * markSent — two-phase broadcast (P9-1, live-readiness).
   *
   * PREVIOUSLY (capital-unsafe): the entire submit (broadcast + tx.wait) ran
   * INSIDE the DB transaction. A crash after broadcast but before commit left
   * the leg in `created` with the tx already in the mempool → a retry
   * re-broadcast → double-spend.
   *
   * NOW (two-phase, crash-safe):
   *   Phase 1 (tx, commit): lock leg + plan, kill-switch check,
   *     `leg.state = 'submitting'`, commit. NO broadcast here.
   *   Phase 2 (outside tx): `venue.submitLeg` / bridge submit — the actual
   *     on-chain broadcast + tx.wait happens here.
   *   Phase 3 (tx, commit): `leg.state = 'sent'`, persist OnChainTransaction
   *     (P9-2, single-writer = OnChainTransactionService) + emit DexTransaction*
   *     outbox event, commit.
   *
   * HTTP contract (architecture guard B1): the endpoint stays SYNCHRONOUS — it
   * blocks until Phase 3 and returns `sent` on success. On a transient error
   * in Phase 2 (tx.wait timeout, RPC drop) the leg STAYS `submitting`; the
   * endpoint returns 503 and the caller must NOT retry markSent (precondition
   * `created` would ConflictException). Recovery is delegated to the stuck-plan
   * reaper (P9-7), which re-checks the on-chain status of the pending tx.
   *
   * Terminal errors (VenueTerminalSubmitError / VenueSubmitClientError) are
   * handled in Phase 1-style transactions: the leg moves to its terminal state
   * atomically and no broadcast occurred.
   */
  async markSent(planId: string, legId: string): Promise<ReturnType<typeof legView>> {
    // ── Phase 1: reserve the leg (created → submitting), commit before broadcast.
    const { plan, leg, isBridgeLeg } = await this.beginMarkSent(planId, legId);

    // ── Phase 2: broadcast OUTSIDE the DB transaction.
    // The venue adapter does sendTransaction + tx.wait here. If the process
    // crashes during Phase 2, the leg is `submitting` (Phase 1 committed) and
    // the reaper (P9-7) will reconcile via the RPC provider.
    let externalOrderId: string;
    let onChainMeta: VenueOnChainMeta | undefined;
    try {
      if (isBridgeLeg) {
        const bridgeParams = extractBridgeParams(
          plan.playbookConfig,
          leg.legIndex,
          plan.id,
          leg.id,
        );
        if (!bridgeParams) {
          // Terminal validation error — flip the leg to failed in a tx.
          await this.failSubmittingLeg(planId, legId, plan.correlationId, `Bridge leg ${legId} has no bridge params in playbookConfig`);
          throw new HttpException(
            `Bridge leg ${legId} has no bridge params in playbookConfig`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        const adapter = this.bridgeAdapterFactory.resolveAdapter(bridgeParams.bridgeKey);
        const transferParams: BridgeTransferParams = {
          sourceChainId: bridgeParams.sourceChainId,
          destinationChainId: bridgeParams.destinationChainId,
          token: bridgeParams.token,
          destinationToken: bridgeParams.destinationToken,
          amount: bridgeParams.amount,
          recipientAddress: bridgeParams.recipientAddress,
          idempotencyKey: `bridge:${plan.id}:${leg.id}`,
        };
        const bridgeEntity = await this.bridgeTransferService.submitBridgeTransfer(
          adapter,
          transferParams,
          leg.id,
        );
        externalOrderId = bridgeEntity.id;
      } else {
        const result = await this.venue.submitLeg(plan, leg);
        externalOrderId = result.externalOrderId;
        onChainMeta = result.onChain;
      }
    } catch (err) {
      // Terminal venue errors → flip leg to terminal state in a tx, no broadcast.
      if (err instanceof VenueTerminalSubmitError) {
        return this.applyTerminalSubmitError(planId, legId, plan.correlationId, err);
      }
      if (err instanceof VenueSubmitClientError) {
        await this.failSubmittingLeg(planId, legId, plan.correlationId, err.message);
        throw new HttpException(
          `Venue submitLeg failed (venue client error): ${err.message}`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      // Transient error (RPC drop, tx.wait timeout, nonce issue): the leg STAYS
      // `submitting`. The endpoint returns 503 so the caller does NOT retry
      // markSent (which would ConflictException on the `created` precondition).
      // Recovery is delegated to the stuck-plan reaper (P9-7).
      const msg = err instanceof Error ? err.message : String(err);
      const transientHint =
        err instanceof VenueSubmitTransientError ||
        msg.includes('MOCK_VENUE_FAIL_SUBMIT_REMAINING')
          ? 'transient; leg is submitting — reaper will recover'
          : 'check venue logs; leg is submitting — reaper will recover';
      throw new HttpException(
        `Venue submitLeg failed (${transientHint}): ${msg}`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    // ── Phase 3: commit the outcome (submitting → sent) + persist on-chain proof.
    return this.completeMarkSent(planId, legId, plan.correlationId, externalOrderId, onChainMeta);
  }

  /**
   * Phase 1 helper: lock plan + leg, kill-switch check, flip `created → submitting`,
   * commit. Returns the locked entities + venue metadata for Phase 2.
   */
  private async beginMarkSent(
    planId: string,
    legId: string,
  ): Promise<{
    plan: ExecutionPlanEntity;
    leg: ExecutionLegEntity;
    isBridgeLeg: boolean;
    venueKey: string | undefined;
    isLiveLeg: boolean;
  }> {
    let ctx!: {
      plan: ExecutionPlanEntity;
      leg: ExecutionLegEntity;
      isBridgeLeg: boolean;
      venueKey: string | undefined;
      isLiveLeg: boolean;
    };
    await this.dataSource.transaction(async (em) => {
      const plan = await em.findOne(ExecutionPlanEntity, {
        where: { id: planId },
        lock: { mode: 'pessimistic_read' },
      });
      if (plan === null) {
        throw new NotFoundException(`Plan not found: ${planId}`);
      }
      if (plan.state !== 'executing') {
        throw new ConflictException(
          `Plan ${planId} must be executing (current: ${plan.state})`,
        );
      }
      const leg = await em.findOne(ExecutionLegEntity, {
        where: { id: legId, planId },
        lock: { mode: 'pessimistic_write' },
      });
      if (leg === null) {
        throw new NotFoundException(`Leg not found: ${legId}`);
      }
      if (leg.state !== 'created') {
        throw new ConflictException(
          `Leg ${legId} must be created to mark sent (current: ${leg.state})`,
        );
      }

      const isBridgeLeg = leg.legType === 'bridge';
      const venueKey = extractVenueKey(plan, leg);
      const isLiveLeg = isBridgeLeg || isLiveVenueKey(venueKey);
      // D4-B-1-KILLSWITCH: block NEW live legs when the kill-switch is active.
      // Paper/legacy legs are never halted (paper/live isolation is structural).
      if (isLiveLeg) {
        await this.killSwitch.assertLiveNotHalted();
      }

      // Flip to `submitting` — this reserves the leg so a concurrent markSent
      // or retry cannot double-broadcast. Commit BEFORE the actual broadcast.
      leg.state = 'submitting';
      leg.entityVersion += 1;
      await em.save(leg);
      ctx = { plan, leg, isBridgeLeg, venueKey, isLiveLeg };
    });
    return ctx;
  }

  /**
   * Phase 3 helper: persist the broadcast outcome. Flips `submitting → sent`,
   * records venueRef, persists OnChainTransaction (P9-2) + emits the DexTransaction
   * outbox event in the SAME transaction. Idempotent on txHash.
   */
  private async completeMarkSent(
    planId: string,
    legId: string,
    correlationId: string | null,
    externalOrderId: string,
    onChainMeta: VenueOnChainMeta | undefined,
  ): Promise<ReturnType<typeof legView>> {
    const saved = await this.dataSource.transaction(async (em) => {
      const leg = await em.findOne(ExecutionLegEntity, {
        where: { id: legId, planId },
        lock: { mode: 'pessimistic_write' },
      });
      if (leg === null) {
        throw new NotFoundException(`Leg not found: ${legId}`);
      }
      // The leg must be `submitting` (Phase 1 committed). If it is already
      // `sent` (idempotent retry after a partial Phase 3) or terminal, return
      // the current view without re-persisting.
      if (leg.state !== 'submitting') {
        return leg;
      }
      leg.state = 'sent';
      leg.entityVersion += 1;
      leg.venueRef = externalOrderId;
      const savedLeg = await em.save(leg);

      // P9-2: persist the on-chain proof atomically with the leg transition.
      // Single-writer = OnChainTransactionService. Emits DexTransactionConfirmed
      // outbox event in the same tx (via dexOutbox).
      if (onChainMeta !== undefined) {
        const oct = await this.onChainTxService.persistWithOutcome(
          em,
          legId,
          {
            txHash: onChainMeta.txHash,
            chainId: onChainMeta.chainId,
            fromAddress: onChainMeta.fromAddress,
            toAddress: onChainMeta.toAddress,
            nonce: onChainMeta.nonce,
            gasLimit: onChainMeta.gasLimit,
            gasUsed: onChainMeta.gasUsed ?? null,
            gasPrice: onChainMeta.gasPrice ?? null,
            maxFeePerGas: onChainMeta.maxFeePerGas ?? null,
            maxPriorityFeePerGas: onChainMeta.maxPriorityFeePerGas ?? null,
            blockNumber: onChainMeta.blockNumber ?? null,
            blockHash: onChainMeta.blockHash ?? null,
            transactionIndex: onChainMeta.transactionIndex ?? null,
            value: onChainMeta.value ?? '0',
            status: onChainMeta.status,
            revertReason: onChainMeta.revertReason ?? null,
          },
        );
        if (oct !== null) {
          if (oct.status === 'confirmed') {
            await this.dexOutbox.emitConfirmed(em, oct, correlationId ?? planId);
          } else {
            await this.dexOutbox.emitFailed(em, oct, correlationId ?? planId);
          }
        }
      }
      return savedLeg;
    });

    this.audit.record({
      idempotencyKey: `execution:MarkLegSent:${saved.id}:v${saved.entityVersion}`,
      correlationId: correlationId ?? undefined,
      actor: 'execution-orchestrator',
      action: 'MarkLegSent',
      resourceType: 'ExecutionLeg',
      resourceId: saved.id,
      payload: { planId, venueRef: externalOrderId },
    });
    return legView(saved);
  }

  /**
   * Flip a `submitting` leg to `failed` (terminal validation/client error in
   * Phase 2 that did not broadcast). Atomic tx.
   */
  private async failSubmittingLeg(
    planId: string,
    legId: string,
    correlationId: string | null,
    message: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const leg = await em.findOne(ExecutionLegEntity, {
        where: { id: legId, planId },
        lock: { mode: 'pessimistic_write' },
      });
      if (leg === null || leg.state !== 'submitting') {
        return;
      }
      leg.state = 'failed';
      leg.entityVersion += 1;
      const saved = await em.save(leg);
      this.audit.record({
        idempotencyKey: `execution:MarkLegSentFail:${saved.id}:v${saved.entityVersion}`,
        correlationId: correlationId ?? undefined,
        actor: 'execution-orchestrator',
        action: 'MarkLegSentFail',
        resourceType: 'ExecutionLeg',
        resourceId: saved.id,
        payload: { planId, message },
      });
    });
  }

  /**
   * Apply a VenueTerminalSubmitError: flip `submitting → terminalState` atomically.
   */
  private async applyTerminalSubmitError(
    planId: string,
    legId: string,
    correlationId: string | null,
    err: VenueTerminalSubmitError,
  ): Promise<ReturnType<typeof legView>> {
    const saved = await this.dataSource.transaction(async (em) => {
      const leg = await em.findOne(ExecutionLegEntity, {
        where: { id: legId, planId },
        lock: { mode: 'pessimistic_write' },
      });
      if (leg === null) {
        throw new NotFoundException(`Leg not found: ${legId}`);
      }
      if (leg.state !== 'submitting') {
        return leg;
      }
      leg.state = err.terminalState;
      leg.entityVersion += 1;
      return em.save(leg);
    });
    this.audit.record({
      idempotencyKey: `execution:MarkLegSentTerminal:${saved.id}:v${saved.entityVersion}`,
      correlationId: correlationId ?? undefined,
      actor: 'execution-orchestrator',
      action: 'MarkLegSentTerminal',
      resourceType: 'ExecutionLeg',
      resourceId: saved.id,
      payload: {
        planId,
        terminalState: err.terminalState,
        message: err.message,
      },
    });
    return legView(saved);
  }

  async markAcknowledged(
    planId: string,
    legId: string,
  ): Promise<ReturnType<typeof legView>> {
    return this.dataSource.transaction(async (em) => {
      const plan = await em.findOne(ExecutionPlanEntity, {
        where: { id: planId },
        lock: { mode: 'pessimistic_read' },
      });
      if (plan === null) {
        throw new NotFoundException(`Plan not found: ${planId}`);
      }
      const leg = await em.findOne(ExecutionLegEntity, {
        where: { id: legId, planId },
        lock: { mode: 'pessimistic_write' },
      });
      if (leg === null) {
        throw new NotFoundException(`Leg not found: ${legId}`);
      }
      if (leg.state !== 'sent') {
        throw new ConflictException(
          `Leg ${legId} must be sent before ack (current: ${leg.state})`,
        );
      }
      leg.state = 'acknowledged';
      leg.entityVersion += 1;
      const saved = await em.save(leg);
      this.audit.record({
        idempotencyKey: `execution:MarkLegAcknowledged:${saved.id}:v${saved.entityVersion}`,
        correlationId: plan.correlationId ?? undefined,
        actor: 'execution-orchestrator',
        action: 'MarkLegAcknowledged',
        resourceType: 'ExecutionLeg',
        resourceId: saved.id,
        payload: { planId },
      });
      return legView(saved);
    });
  }

  async applyFill(
    planId: string,
    legId: string,
    dto: ApplyFillDto,
  ): Promise<ReturnType<typeof legView>> {
    const auditIdempotencyKey =
      dto.idempotencyKey !== undefined && dto.idempotencyKey.length > 0
        ? `execution:ApplyFill:${dto.idempotencyKey}`
        : `execution:ApplyFill:${legId}:v${dto.clientKnownVersion ?? 'na'}`;
    let correlationId: string | null = null;
    let instrumentKeyForSettlement: string | null = null;
    // D4-B-3-CEILING: leg context for pricing the fill into a USD notional
    // (resolved inside the tx from on-chain tx + playbook leg; passed out so
    // the post-commit settlement can re-price via PriceOracleService).
    let chainIdForSettlement: number | undefined;
    let tokenInForSettlement: string | undefined;
    const view = await this.dataSource.transaction(async (em) => {
      const plan = await em.findOne(ExecutionPlanEntity, {
        where: { id: planId },
        lock: { mode: 'pessimistic_read' },
      });
      if (plan === null) {
        throw new NotFoundException(`Plan not found: ${planId}`);
      }
      correlationId = plan.correlationId ?? null;
      const leg = await em.findOne(ExecutionLegEntity, {
        where: { id: legId, planId },
        lock: { mode: 'pessimistic_write' },
      });
      if (leg === null) {
        throw new NotFoundException(`Leg not found: ${legId}`);
      }

      if (
        dto.idempotencyKey !== undefined &&
        dto.idempotencyKey.length > 0
      ) {
        const prior = await em.findOne(ExecutionLegFillIdempotencyEntity, {
          where: { legId, idempotencyKey: dto.idempotencyKey },
        });
        if (prior !== null) {
          return legView(leg);
        }
      }

      if (
        dto.clientKnownVersion !== undefined &&
        dto.clientKnownVersion !== leg.entityVersion
      ) {
        throw new ConflictException(
          `Leg ${legId} version mismatch: expected ${dto.clientKnownVersion}, actual ${leg.entityVersion}`,
        );
      }

      if (leg.state !== 'acknowledged' && leg.state !== 'partiallyFilled') {
        throw new ConflictException(
          `Leg ${legId} must be acknowledged or partiallyFilled before fill (current: ${leg.state})`,
        );
      }

      const mode = dto.mode ?? 'full';
      let nextFilled: number;
      let nextState: string;

      if (mode === 'full') {
        nextFilled = leg.targetQuantity;
        nextState = 'filled';
      } else {
        if (dto.cumulativeFilled === undefined) {
          throw new BadRequestException(
            'cumulativeFilled is required when mode=partial',
          );
        }
        const c = dto.cumulativeFilled;
        if (c <= leg.filledQuantity) {
          throw new ConflictException(
            `cumulativeFilled (${c}) must exceed current filled (${leg.filledQuantity})`,
          );
        }
        if (c > leg.targetQuantity) {
          throw new ConflictException(
            `cumulativeFilled (${c}) exceeds targetQuantity (${leg.targetQuantity})`,
          );
        }
        nextFilled = c;
        nextState = c >= leg.targetQuantity ? 'filled' : 'partiallyFilled';
      }

      leg.filledQuantity = nextFilled;
      leg.state = nextState;
      leg.entityVersion += 1;
      const saved = await em.save(leg);
      if (saved.state === 'partiallyFilled') {
        executionLegPartialFillCommits.inc();
      }

      if (dto.idempotencyKey !== undefined && dto.idempotencyKey.length > 0) {
        try {
          await em.insert(ExecutionLegFillIdempotencyEntity, {
            legId: saved.id,
            idempotencyKey: dto.idempotencyKey,
            resultingState: saved.state,
            resultingFilledQuantity: saved.filledQuantity,
            resultingEntityVersion: saved.entityVersion,
          });
        } catch (err) {
          if (isPgUniqueViolation(err)) {
            const cur = await em.findOne(ExecutionLegEntity, {
              where: { id: legId, planId },
              lock: { mode: 'pessimistic_read' },
            });
            if (cur === null) {
              throw new NotFoundException(`Leg not found: ${legId}`);
            }
            return legView(cur);
          }
          throw err;
        }
      }

      if (saved.state === 'filled') {
        const messageId = randomUUID();
        const createdAt = new Date();
        const correlationForEnvelope =
          plan.correlationId !== null && plan.correlationId.trim().length > 0
            ? plan.correlationId
            : plan.id;

        // DEX-1-2-FILL-TRACKING: enrich outbox payload with on-chain metadata
        const onChainTx = await em.findOne(OnChainTransaction, {
          where: { legId: saved.id, status: 'confirmed' },
          order: { createdAt: 'DESC' },
        });
        // D4-B-3-CEILING: capture chainId from the confirmed on-chain tx so the
        // post-commit settlement can price the fill into a USD notional. Absent
        // (non-DEX leg / no confirmed tx) → FillOutboundService prices '0'.
        if (onChainTx !== null) {
          chainIdForSettlement = onChainTx.chainId;
        }
        const dexMeta = onChainTx !== null
          ? {
              txHash: onChainTx.txHash,
              chainId: onChainTx.chainId,
              gasUsed: onChainTx.gasUsed,
              effectiveGasPrice: onChainTx.gasPrice,
              blockNumber: onChainTx.blockNumber,
              fromAddress: onChainTx.fromAddress,
              toAddress: onChainTx.toAddress,
            }
          : undefined;

        const payload: LegFilledPayloadV2 = {
          legId: saved.id,
          planId: saved.planId,
          state: 'filled',
          filledQuantity: saved.filledQuantity,
          entityVersion: saved.entityVersion,
          ...(dexMeta !== undefined ? { dex: dexMeta } : {}),
        };
        const envelope = {
          messageId,
          correlationId: correlationForEnvelope,
          entityType: 'ExecutionLeg',
          entityId: saved.id,
          version: LEG_FILLED_PAYLOAD_SCHEMA_VERSION,
          sourceModule: SERVICE_IDS.executionOrchestrator,
          eventTs: createdAt.toISOString(),
          eventName: EVENT_NAMES.legFilled,
          payload,
        };
        const outbox = em.create(OutboxEventEntity, {
          messageId,
          eventType: EVENT_NAMES.legFilled,
          entityType: 'ExecutionLeg',
          entityId: saved.id,
          schemaVersion: LEG_FILLED_PAYLOAD_SCHEMA_VERSION,
          payload: payload as unknown as Record<string, unknown>,
          envelope: envelope as unknown as Record<string, unknown>,
          processedAt: null,
        });
        await em.save(OutboxEventEntity, outbox);
      }

      this.audit.record({
        idempotencyKey: auditIdempotencyKey,
        correlationId: plan.correlationId ?? undefined,
        actor: 'execution-orchestrator',
        action: 'ApplyFill',
        resourceType: 'ExecutionLeg',
        resourceId: saved.id,
        payload: { planId, mode, cumulativeFilled: dto.cumulativeFilled },
      });
      if (saved.state === 'filled') {
        instrumentKeyForSettlement = resolveInstrumentKeyForPlan(plan);
        // D4-B-3-CEILING: tokenIn from the multi-leg playbook
        // (config.legs[legIndex].tokenIn, D4-B-2c format). Absent → FillOutboundService
        // prices notional as '0' (non-fatal).
        const legTokenIn = readLegTokenIn(plan.playbookConfig, saved.legIndex);
        if (legTokenIn !== null) {
          tokenInForSettlement = legTokenIn;
        }
      }
      return legView(saved);
    });

    if (view.state === 'filled' && instrumentKeyForSettlement !== null) {
      await this.fillOutbound.afterLegFullyFilled({
        planId,
        legId,
        legIndex: view.legIndex,
        filledQuantity: view.filledQuantity,
        instrumentKey: instrumentKeyForSettlement,
        correlationId,
        chainId: chainIdForSettlement,
        tokenIn: tokenInForSettlement,
      });
    }

    return view;
  }

  private async assertPlanExists(planId: string): Promise<void> {
    const row = await this.plans.findOne({ where: { id: planId } });
    if (row === null) {
      throw new NotFoundException(`Plan not found: ${planId}`);
    }
  }
}

/** Round a USD cost value to 2 decimal places for persistence. */
function round2(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}
