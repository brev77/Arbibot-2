import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import {
  EVENT_NAMES,
  PLAN_ARMED_PAYLOAD_SCHEMA_VERSION,
  PLAN_COMPLETED_PAYLOAD_SCHEMA_VERSION,
  SERVICE_IDS,
  type PlanArmedPayloadV1,
  type PlanCompletedPayloadV1,
} from '@arbibot/contracts';
import {
  CapitalReservationEntity,
  ExecutionLegEntity,
  ExecutionPlanEntity,
  OutboxEventEntity,
  RiskDecisionEntity,
} from '@arbibot/persistence';
import {
  AuditClientService,
  getCorrelationId,
  type IAuditClient,
} from '@arbibot/nest-platform';

import type { CreatePlanDto } from './dto/create-plan.dto';

@Injectable()
export class PlansService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ExecutionPlanEntity)
    private readonly plans: Repository<ExecutionPlanEntity>,
    @Inject(AuditClientService) private readonly audit: IAuditClient,
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
    await this.refreshReservationState(capitalReservationId);
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
      await this.assertApprovedRiskDecision(em, plan);
      const res = await em.findOne(CapitalReservationEntity, {
        where: { id: capitalReservationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (res === null) {
        throw new NotFoundException(
          `Reservation not found: ${capitalReservationId}`,
        );
      }
      this.assertReservationActive(res);
      this.assertReservationMatchesPlan(plan, res);
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
    const reservationId = peek?.capitalReservationId ?? null;
    if (reservationId !== null) {
      await this.refreshReservationState(reservationId);
    }
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
      await this.assertApprovedRiskDecision(em, plan);
      if (plan.capitalReservationId === null) {
        throw new ConflictException(`Plan ${planId} has no capital reservation`);
      }
      const res = await em.findOne(CapitalReservationEntity, {
        where: { id: plan.capitalReservationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (res === null) {
        throw new ConflictException(
          `Reservation ${plan.capitalReservationId} missing`,
        );
      }
      this.assertReservationActive(res);
      this.assertReservationMatchesPlan(plan, res);
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

  private async refreshReservationState(id: string): Promise<void> {
    const baseUrl =
      process.env.CAPITAL_SERVICE_BASE_URL ?? 'http://127.0.0.1:3011';
    try {
      const cid = getCorrelationId();
      const headers: Record<string, string> = { accept: 'application/json' };
      if (cid !== undefined && cid.length > 0) {
        headers['x-correlation-id'] = cid;
      }
      await fetch(`${baseUrl}/capital/reservations/${id}`, {
        method: 'GET',
        headers,
      });
    } catch {
      // Best effort: capital-service remains the single writer for reservation
      // lifecycle, while the local state checks below still block expired rows.
    }
  }

  private assertReservationActive(res: CapitalReservationEntity): void {
    if (res.state !== 'active') {
      if (res.state === 'expired') {
        throw new ConflictException(`Reservation ${res.id} has expired`);
      }
      throw new ConflictException(
        `Reservation ${res.id} is not active (state=${res.state})`,
      );
    }
    if (res.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException(`Reservation ${res.id} has expired`);
    }
  }

  private async assertApprovedRiskDecision(
    em: EntityManager,
    plan: ExecutionPlanEntity,
  ): Promise<void> {
    if (plan.riskDecisionId === null) {
      throw new ConflictException(
        `Plan ${plan.id} must reference an approved risk decision before reservation/arm`,
      );
    }
    const risk = await em.findOne(RiskDecisionEntity, {
      where: { id: plan.riskDecisionId },
      lock: { mode: 'pessimistic_read' },
    });
    if (risk === null) {
      throw new ConflictException(
        `Risk decision ${plan.riskDecisionId} missing for plan ${plan.id}`,
      );
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

  private assertReservationMatchesPlan(
    plan: ExecutionPlanEntity,
    res: CapitalReservationEntity,
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
