import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import {
  EVENT_NAMES,
  PLAN_ARMED_PAYLOAD_SCHEMA_VERSION,
  PLAN_COMPLETED_PAYLOAD_SCHEMA_VERSION,
  SERVICE_IDS,
  type PlanArmedPayloadV1,
  type PlanCompletedPayloadV1,
} from '@arbibot/contracts';
import {
  ExecutionLegEntity,
  ExecutionPlanEntity,
  OutboxEventEntity,
} from '@arbibot/persistence';
import {
  AuditClientService,
  type IAuditClient,
} from '@arbibot/nest-platform';

import type { CapitalReservationSnapshot } from '../integration/capital-http.client';
import { CapitalHttpClient } from '../integration/capital-http.client';
import { RiskHttpClient } from '../integration/risk-http.client';

import type { CreatePlanDto } from './dto/create-plan.dto';

@Injectable()
export class PlansService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ExecutionPlanEntity)
    private readonly plans: Repository<ExecutionPlanEntity>,
    @Inject(AuditClientService) private readonly audit: IAuditClient,
    private readonly capitalHttp: CapitalHttpClient,
    private readonly riskHttp: RiskHttpClient,
  ) {}

  async create(dto: CreatePlanDto): Promise<ExecutionPlanEntity> {
    const row = this.plans.create({
      correlationId: dto.correlationId ?? null,
      riskDecisionId: dto.riskDecisionId ?? null,
      routeKey: dto.routeKey?.trim() ?? null,
      state: 'planned',
      capitalReservationId: null,
      entityVersion: 1,
    });
    return this.plans.save(row);
  }

  async list(): Promise<ExecutionPlanEntity[]> {
    return this.plans.find({ order: { createdAt: 'DESC' }, take: 100 });
  }

  async getById(id: string): Promise<ExecutionPlanEntity> {
    const row = await this.plans.findOne({ where: { id } });
    if (row === null) {
      throw new NotFoundException(`Plan not found: ${id}`);
    }
    return row;
  }

  async linkReservation(
    planId: string,
    capitalReservationId: string,
  ): Promise<ExecutionPlanEntity> {
    const peek = await this.plans.findOne({ where: { id: planId } });
    if (peek === null) {
      throw new NotFoundException(`Plan not found: ${planId}`);
    }
    if (peek.state !== 'planned') {
      throw new ConflictException(
        `Plan ${planId} must be planned to link reservation (current: ${peek.state})`,
      );
    }
    await this.assertApprovedRiskViaHttp(peek);
    const res = await this.loadReservationSnapshotTwice(
      capitalReservationId,
      'not-found',
    );
    this.assertReservationActive(res);
    this.assertReservationMatchesPlan(peek, res);

    return this.dataSource.transaction(async (em) => {
      const plan = await em.findOne(ExecutionPlanEntity, {
        where: { id: planId },
        lock: { mode: 'pessimistic_write' },
      });
      if (plan === null) {
        throw new NotFoundException(`Plan not found: ${planId}`);
      }
      if (plan.state !== 'planned') {
        throw new ConflictException(
          `Plan ${planId} must be planned to link reservation (current: ${plan.state})`,
        );
      }
      plan.capitalReservationId = capitalReservationId;
      plan.state = 'reserved';
      plan.entityVersion += 1;
      const saved = await em.save(ExecutionPlanEntity, plan);
      this.audit.record({
        idempotencyKey: `execution:LinkReservation:${saved.id}:${capitalReservationId}`,
        correlationId: saved.correlationId ?? undefined,
        actor: 'execution-orchestrator',
        action: 'LinkReservation',
        resourceType: 'ExecutionPlan',
        resourceId: saved.id,
        payload: {
          capitalReservationId,
          state: saved.state,
        },
      });
      return saved;
    });
  }

  async arm(planId: string): Promise<ExecutionPlanEntity> {
    const peek = await this.plans.findOne({ where: { id: planId } });
    if (peek === null) {
      throw new NotFoundException(`Plan not found: ${planId}`);
    }
    if (peek.state !== 'reserved') {
      throw new ConflictException(
        `Plan ${planId} must be reserved before arm (current: ${peek.state})`,
      );
    }
    if (peek.capitalReservationId === null) {
      throw new ConflictException(`Plan ${planId} has no capital reservation`);
    }
    await this.assertApprovedRiskViaHttp(peek);
    const res = await this.loadReservationSnapshotTwice(
      peek.capitalReservationId,
      'conflict',
    );
    this.assertReservationActive(res);
    this.assertReservationMatchesPlan(peek, res);

    return this.dataSource.transaction(async (em) => {
      const plan = await em.findOne(ExecutionPlanEntity, {
        where: { id: planId },
        lock: { mode: 'pessimistic_write' },
      });
      if (plan === null) {
        throw new NotFoundException(`Plan not found: ${planId}`);
      }
      if (plan.state !== 'reserved') {
        throw new ConflictException(
          `Plan ${planId} must be reserved before arm (current: ${plan.state})`,
        );
      }
      if (plan.capitalReservationId === null) {
        throw new ConflictException(`Plan ${planId} has no capital reservation`);
      }
      plan.state = 'armed';
      plan.entityVersion += 1;
      const saved = await em.save(ExecutionPlanEntity, plan);
      const messageId = randomUUID();
      const createdAt = new Date();
      const correlationForEnvelope =
        saved.correlationId !== null && saved.correlationId.length > 0
          ? saved.correlationId
          : saved.id;
      const payload: PlanArmedPayloadV1 = {
        planId: saved.id,
        state: 'armed',
        capitalReservationId: saved.capitalReservationId!,
        riskDecisionId: saved.riskDecisionId,
        entityVersion: saved.entityVersion,
      };
      const envelope = {
        messageId,
        correlationId: correlationForEnvelope,
        entityType: 'ExecutionPlan',
        entityId: saved.id,
        version: PLAN_ARMED_PAYLOAD_SCHEMA_VERSION,
        sourceModule: SERVICE_IDS.executionOrchestrator,
        eventTs: createdAt.toISOString(),
        eventName: EVENT_NAMES.planArmed,
        payload,
      };
      const outbox = em.create(OutboxEventEntity, {
        messageId,
        eventType: EVENT_NAMES.planArmed,
        entityType: 'ExecutionPlan',
        entityId: saved.id,
        schemaVersion: PLAN_ARMED_PAYLOAD_SCHEMA_VERSION,
        payload: payload as unknown as Record<string, unknown>,
        envelope: envelope as unknown as Record<string, unknown>,
        processedAt: null,
      });
      await em.save(OutboxEventEntity, outbox);
      this.audit.record({
        idempotencyKey: `execution:ArmPlan:${saved.id}:v${saved.entityVersion}`,
        correlationId: saved.correlationId ?? undefined,
        actor: 'execution-orchestrator',
        action: 'ArmPlan',
        resourceType: 'ExecutionPlan',
        resourceId: saved.id,
        payload: {
          state: saved.state,
          capitalReservationId: saved.capitalReservationId,
        },
      });
      return saved;
    });
  }

  /**
   * When every leg for the plan is `filled`, move plan `executing` → `completed`.
   * No-op if legs are incomplete or plan is not executing.
   */
  async tryMarkPlanCompletedWhenAllLegsFilled(
    planId: string,
  ): Promise<{ completed: boolean; plan: ExecutionPlanEntity | null }> {
    return this.dataSource.transaction(async (em) => {
      const legsForPlan = await em.find(ExecutionLegEntity, {
        where: { planId },
      });
      if (legsForPlan.length === 0) {
        return { completed: false, plan: null };
      }
      if (legsForPlan.some((l) => l.state !== 'filled')) {
        return { completed: false, plan: null };
      }

      const plan = await em.findOne(ExecutionPlanEntity, {
        where: { id: planId },
        lock: { mode: 'pessimistic_write' },
      });
      if (plan === null || plan.state !== 'executing') {
        return { completed: false, plan: plan ?? null };
      }
      plan.state = 'completed';
      plan.entityVersion += 1;
      const saved = await em.save(ExecutionPlanEntity, plan);
      const messageId = randomUUID();
      const createdAt = new Date();
      const correlationForEnvelope =
        saved.correlationId !== null && saved.correlationId.trim().length > 0
          ? saved.correlationId
          : saved.id;
      const payload: PlanCompletedPayloadV1 = {
        planId: saved.id,
        state: 'completed',
        entityVersion: saved.entityVersion,
        capitalReservationId: saved.capitalReservationId,
      };
      const envelope = {
        messageId,
        correlationId: correlationForEnvelope,
        entityType: 'ExecutionPlan',
        entityId: saved.id,
        version: PLAN_COMPLETED_PAYLOAD_SCHEMA_VERSION,
        sourceModule: SERVICE_IDS.executionOrchestrator,
        eventTs: createdAt.toISOString(),
        eventName: EVENT_NAMES.planCompleted,
        payload,
      };
      const outbox = em.create(OutboxEventEntity, {
        messageId,
        eventType: EVENT_NAMES.planCompleted,
        entityType: 'ExecutionPlan',
        entityId: saved.id,
        schemaVersion: PLAN_COMPLETED_PAYLOAD_SCHEMA_VERSION,
        payload: payload as unknown as Record<string, unknown>,
        envelope: envelope as unknown as Record<string, unknown>,
        processedAt: null,
      });
      await em.save(OutboxEventEntity, outbox);
      this.audit.record({
        idempotencyKey: `execution:MarkPlanCompleted:${saved.id}:v${saved.entityVersion}`,
        correlationId: saved.correlationId ?? undefined,
        actor: 'execution-orchestrator',
        action: 'MarkPlanCompleted',
        resourceType: 'ExecutionPlan',
        resourceId: saved.id,
        payload: { state: saved.state },
      });
      return { completed: true, plan: saved };
    });
  }

  /** Two authoritative reads before mutating the plan (TOCTOU mitigation vs single GET). */
  private async loadReservationSnapshotTwice(
    reservationId: string,
    ifMissing: 'not-found' | 'conflict',
  ): Promise<CapitalReservationSnapshot> {
    try {
      await this.capitalHttp.getReservation(reservationId);
      return await this.capitalHttp.getReservation(reservationId);
    } catch (e) {
      if (e instanceof NotFoundException && ifMissing === 'conflict') {
        throw new ConflictException(`Reservation ${reservationId} missing`);
      }
      throw e;
    }
  }

  private async assertApprovedRiskViaHttp(
    plan: ExecutionPlanEntity,
  ): Promise<void> {
    if (plan.riskDecisionId === null) {
      throw new ConflictException(
        `Plan ${plan.id} must reference an approved risk decision before reservation/arm`,
      );
    }
    let risk: { id: string; correlationId: string; outcome: string };
    try {
      risk = await this.riskHttp.getRiskDecision(plan.riskDecisionId);
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw new ConflictException(
          `Risk decision ${plan.riskDecisionId} missing for plan ${plan.id}`,
        );
      }
      throw e;
    }
    if (risk.outcome !== 'approved') {
      throw new ConflictException(
        `Risk decision ${risk.id} must be approved before reservation/arm (outcome=${risk.outcome})`,
      );
    }
    if (plan.correlationId !== null && risk.correlationId !== plan.correlationId) {
      throw new ConflictException(
        `Risk decision ${risk.id} correlation does not match plan ${plan.id}`,
      );
    }
  }

  private assertReservationActive(res: CapitalReservationSnapshot): void {
    if (res.state !== 'active') {
      if (res.state === 'expired') {
        throw new ConflictException(`Reservation ${res.id} has expired`);
      }
      throw new ConflictException(
        `Reservation ${res.id} is not active (state=${res.state})`,
      );
    }
    const expiresMs = Date.parse(res.expiresAtIso);
    if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
      throw new ConflictException(`Reservation ${res.id} has expired`);
    }
  }

  private assertReservationMatchesPlan(
    plan: ExecutionPlanEntity,
    res: CapitalReservationSnapshot,
  ): void {
    if (res.planId === null) {
      throw new ConflictException(
        `Reservation ${res.id} must be linked to plan ${plan.id} by capital-service before orchestration`,
      );
    }
    if (res.planId !== plan.id) {
      throw new ConflictException(
        `Reservation ${res.id} belongs to plan ${res.planId}, not ${plan.id}`,
      );
    }
    if (plan.correlationId !== null && res.correlationId !== plan.correlationId) {
      throw new ConflictException(
        `Reservation ${res.id} correlation does not match plan ${plan.id}`,
      );
    }
  }
}
