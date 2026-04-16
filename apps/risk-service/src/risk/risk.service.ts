import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';

import {
  EVENT_NAMES,
  SERVICE_IDS,
  type RiskDecisionIssuedPayloadV1,
} from '@arbibot/contracts';
import { AuditClientService, type IAuditClient } from '@arbibot/nest-platform';
import {
  materializeRiskWindowReservationExpiryIfNeeded,
  OutboxEventEntity,
  RiskDecisionEntity,
  RiskWindowReservationEntity,
} from '@arbibot/persistence';
import { DataSource, Repository } from 'typeorm';

import type {
  EvaluateRiskInput,
  RiskDecision,
  RiskMode,
} from './domain/risk-decision';
import type { EvaluateRiskRequestDto } from './dto/evaluate-risk-request.dto';
import type { EvaluateRiskResponseDto } from './dto/evaluate-risk-response.dto';
import type { ReserveRiskWindowRequestDto } from './dto/reserve-risk-window-request.dto';
import type { ReserveRiskWindowResponseDto } from './dto/reserve-risk-window-response.dto';
import type { RiskDecisionResponseDto } from './dto/risk-decision-response.dto';
import { toEvaluateRiskResponse, toRiskDecisionResponse } from './risk.mapper';
import { evaluateRiskPolicy } from './risk.policy';

const RISK_PAYLOAD_SCHEMA_VERSION = 1;

export interface EvaluateRiskResult {
  readonly response: EvaluateRiskResponseDto;
  readonly replay: boolean;
  /** Present only when a new outbox row was written in this call. */
  readonly outboxMessageId?: string;
}

/**
 * Single-writer for risk decisions: all persisted decisions are created here.
 */
@Injectable()
export class RiskService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(RiskDecisionEntity)
    private readonly decisionRepo: Repository<RiskDecisionEntity>,
    @Inject(AuditClientService) private readonly audit: IAuditClient,
  ) {}

  async reserveRiskWindow(
    dto: ReserveRiskWindowRequestDto,
  ): Promise<ReserveRiskWindowResponseDto> {
    const ttlSeconds = dto.ttlSeconds ?? 900;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const row = await this.dataSource.transaction(async (em) => {
      const created = em.create(RiskWindowReservationEntity, {
        windowKey: dto.windowKey,
        correlationId: dto.correlationId,
        planReference: dto.planReference,
        notionalUsd: String(dto.notionalUsd),
        state: 'reserved',
        entityVersion: 1,
        expiresAt,
      });
      return em.save(RiskWindowReservationEntity, created);
    });
    const out = {
      reservationId: row.id,
      expiresAtIso: row.expiresAt.toISOString(),
      entityVersion: row.entityVersion,
    } satisfies ReserveRiskWindowResponseDto;
    this.audit.record({
      idempotencyKey: `risk:ReserveRiskWindow:${row.id}`,
      correlationId: dto.correlationId,
      actor: 'risk-service',
      action: 'ReserveRiskWindow',
      resourceType: 'RiskWindowReservation',
      resourceId: row.id,
      payload: {
        windowKey: dto.windowKey,
        planReference: dto.planReference,
        notionalUsd: dto.notionalUsd,
      },
    });
    return out;
  }

  async evaluateRisk(request: EvaluateRiskRequestDto): Promise<EvaluateRiskResult> {
    const riskMode: RiskMode = request.riskMode ?? 'standard';
    const input: EvaluateRiskInput = {
      correlationId: request.correlationId,
      planReference: request.planReference,
      notionalUsd: request.notionalUsd,
      snapshotVersion: request.snapshotVersion,
      riskMode,
    };
    const { outcome, reasons } = evaluateRiskPolicy({
      notionalUsd: input.notionalUsd,
      riskMode: input.riskMode,
      now: new Date(),
    });

    const { row, replay, outboxMessageId } = await this.dataSource.transaction(
      async (em) => {
      if (request.idempotencyKey !== undefined) {
        const existing = await em.findOne(RiskDecisionEntity, {
          where: { idempotencyKey: request.idempotencyKey },
          lock: { mode: 'pessimistic_write' },
        });
        if (existing !== null) {
          this.assertSameEvaluateRequest(existing, input, request);
          return { row: existing, replay: true, outboxMessageId: undefined };
        }
      }

      let riskWindowReservationId: string | null = null;
      if (request.riskWindowReservationId !== undefined) {
        const resv = await em.findOne(RiskWindowReservationEntity, {
          where: { id: request.riskWindowReservationId },
          lock: { mode: 'pessimistic_write' },
        });
        if (resv === null) {
          throw new BadRequestException('Unknown risk window reservation');
        }
        const now = new Date();
        materializeRiskWindowReservationExpiryIfNeeded(resv, now);
        if (resv.state !== 'reserved') {
          throw new BadRequestException(
            `Risk window reservation not usable (state=${resv.state})`,
          );
        }
        if (resv.correlationId !== input.correlationId) {
          throw new ConflictException(
            'Risk window reservation correlationId mismatch',
          );
        }
        if (resv.planReference !== input.planReference) {
          throw new ConflictException(
            'Risk window reservation planReference mismatch',
          );
        }
        if (
          Math.abs(Number(resv.notionalUsd) - input.notionalUsd) > 1e-8
        ) {
          throw new ConflictException(
            'Risk window reservation notionalUsd mismatch',
          );
        }
        resv.state = 'consumed';
        resv.entityVersion += 1;
        await em.save(RiskWindowReservationEntity, resv);
        riskWindowReservationId = resv.id;
      }

      const id = randomUUID();
      const messageId = randomUUID();
      const createdAt = new Date();

      const row = em.create(RiskDecisionEntity, {
        id,
        correlationId: input.correlationId,
        planReference: input.planReference,
        outcome,
        reasons: [...reasons],
        snapshotVersion: input.snapshotVersion,
        riskMode: input.riskMode,
        notionalUsd: String(input.notionalUsd),
        idempotencyKey: request.idempotencyKey ?? null,
        riskWindowReservationId,
        entityVersion: 1,
        createdAt,
      });
      await em.save(RiskDecisionEntity, row);

      const payload: RiskDecisionIssuedPayloadV1 = {
        decisionId: id,
        outcome,
        planReference: input.planReference,
        notionalUsd: input.notionalUsd,
        snapshotVersion: input.snapshotVersion,
        riskMode: input.riskMode,
        reasons,
      };

      const envelope = {
        messageId,
        correlationId: input.correlationId,
        entityType: 'RiskDecision',
        entityId: id,
        version: RISK_PAYLOAD_SCHEMA_VERSION,
        sourceModule: SERVICE_IDS.riskService,
        eventTs: createdAt.toISOString(),
        eventName: EVENT_NAMES.riskDecisionIssued,
        payload,
      };

      const outbox = em.create(OutboxEventEntity, {
        messageId,
        eventType: EVENT_NAMES.riskDecisionIssued,
        entityType: 'RiskDecision',
        entityId: id,
        schemaVersion: RISK_PAYLOAD_SCHEMA_VERSION,
        payload: payload as unknown as Record<string, unknown>,
        envelope: envelope as unknown as Record<string, unknown>,
        processedAt: null,
      });
      await em.save(OutboxEventEntity, outbox);

      return { row, replay: false, outboxMessageId: messageId };
    },
    );

    if (!replay) {
      this.audit.record({
        idempotencyKey: `risk:EvaluateRisk:${row.id}`,
        correlationId: input.correlationId,
        actor: 'risk-service',
        action: 'EvaluateRisk',
        resourceType: 'RiskDecision',
        resourceId: row.id,
        payload: {
          outcome: row.outcome,
          planReference: row.planReference,
          snapshotVersion: row.snapshotVersion,
        },
      });
    }

    return {
      replay,
      response: toEvaluateRiskResponse(
        this.entityToDomain(row),
        replay ? undefined : outboxMessageId,
      ),
    };
  }

  private assertSameEvaluateRequest(
    row: RiskDecisionEntity,
    input: EvaluateRiskInput,
    request: EvaluateRiskRequestDto,
  ): void {
    const notionalMatches =
      Math.abs(Number(row.notionalUsd) - input.notionalUsd) < 1e-8;
    const resvMatch =
      (row.riskWindowReservationId ?? null) ===
      (request.riskWindowReservationId ?? null);
    const same =
      row.correlationId === input.correlationId &&
      row.planReference === input.planReference &&
      row.snapshotVersion === input.snapshotVersion &&
      row.riskMode === input.riskMode &&
      notionalMatches &&
      resvMatch;
    if (!same) {
      throw new ConflictException(
        `Risk idempotency key ${row.idempotencyKey} conflicts with request payload`,
      );
    }
  }

  async getRiskDecision(id: string): Promise<RiskDecisionResponseDto> {
    const row = await this.decisionRepo.findOne({ where: { id } });
    if (row === null) {
      throw new NotFoundException(`Risk decision not found: ${id}`);
    }
    return toRiskDecisionResponse(this.entityToDomain(row));
  }

  private entityToDomain(row: RiskDecisionEntity): RiskDecision {
    return {
      id: row.id,
      correlationId: row.correlationId,
      planReference: row.planReference,
      outcome: row.outcome,
      reasons: row.reasons,
      notionalUsd: Number(row.notionalUsd),
      snapshotVersion: row.snapshotVersion,
      riskMode: row.riskMode,
      createdAtIso: row.createdAt.toISOString(),
      entityVersion: row.entityVersion,
    };
  }
}
