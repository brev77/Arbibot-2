import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { DataSource, Repository } from 'typeorm';

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
} from '../venue/venue-adapter';
import { BridgeAdapterFactoryService, extractBridgeParams } from '../execution/bridge/bridge-adapter-factory.service';
import { BridgeTransferService } from '../execution/bridge/bridge-transfer.service';
import type { BridgeTransferParams } from '../execution/bridge/bridge-adapter.interface';
import { MultiLegPlanBuilderService } from '../plans/multi-leg-plan-builder.service';

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

  async markSent(planId: string, legId: string): Promise<ReturnType<typeof legView>> {
    return this.dataSource.transaction(async (em) => {
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
      let externalOrderId: string;

      // ── Bridge-aware execution ──────────────────────────────────────────
      // If the leg is a bridge leg (legType === 'bridge'), delegate to
      // BridgeTransferService which handles adapter resolution, submission,
      // idempotency, and persistence.
      const isBridgeLeg = leg.legType === 'bridge';

      try {
        if (isBridgeLeg) {
          const bridgeParams = extractBridgeParams(
            plan.playbookConfig,
            leg.legIndex,
            plan.id,
            leg.id,
          );

          if (!bridgeParams) {
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

          // BridgeTransferService.submitBridgeTransfer handles:
          //  - idempotency (existing active → return, failed → reject)
          //  - adapter.submitBridgeTransfer call
          //  - persist BridgeTransferEntity
          const bridgeEntity = await this.bridgeTransferService.submitBridgeTransfer(
            adapter,
            transferParams,
            leg.id,
          );
          externalOrderId = bridgeEntity.id; // bridge transfer UUID as venueRef
        } else {
          ({ externalOrderId } = await this.venue.submitLeg(plan, leg));
        }
      } catch (err) {
        if (err instanceof VenueTerminalSubmitError) {
          leg.state = err.terminalState;
          leg.entityVersion += 1;
          const savedTerminal = await em.save(leg);
          this.audit.record({
            idempotencyKey: `execution:MarkLegSentTerminal:${savedTerminal.id}:v${savedTerminal.entityVersion}`,
            correlationId: plan.correlationId ?? undefined,
            actor: 'execution-orchestrator',
            action: 'MarkLegSentTerminal',
            resourceType: 'ExecutionLeg',
            resourceId: savedTerminal.id,
            payload: {
              planId,
              terminalState: err.terminalState,
              message: err.message,
            },
          });
          return legView(savedTerminal);
        }
        if (err instanceof VenueSubmitClientError) {
          const msg = err.message;
          throw new HttpException(
            `Venue submitLeg failed (venue client error): ${msg}`,
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
        const msg = err instanceof Error ? err.message : String(err);
        const transientHint =
          err instanceof VenueSubmitTransientError ||
          msg.includes('MOCK_VENUE_FAIL_SUBMIT_REMAINING')
            ? 'transient; retry mark-sent'
            : 'check venue logs';
        throw new HttpException(
          `Venue submitLeg failed (${transientHint}): ${msg}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      leg.state = 'sent';
      leg.entityVersion += 1;
      leg.venueRef = externalOrderId;
      const saved = await em.save(leg);
      this.audit.record({
        idempotencyKey: `execution:MarkLegSent:${saved.id}:v${saved.entityVersion}`,
        correlationId: plan.correlationId ?? undefined,
        actor: 'execution-orchestrator',
        action: 'MarkLegSent',
        resourceType: 'ExecutionLeg',
        resourceId: saved.id,
        payload: { planId, venueRef: externalOrderId },
      });
      return legView(saved);
    });
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
