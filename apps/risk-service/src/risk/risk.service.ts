import {
  ConflictException,
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
import { OutboxEventEntity, RiskDecisionEntity } from '@arbibot/persistence';
import { DataSource, Repository } from 'typeorm';

import type {
  EvaluateRiskInput,
  RiskDecision,
  RiskMode,
} from './domain/risk-decision';
import type { EvaluateRiskRequestDto } from './dto/evaluate-risk-request.dto';
import type { EvaluateRiskResponseDto } from './dto/evaluate-risk-response.dto';
import type { RiskDecisionResponseDto } from './dto/risk-decision-response.dto';
import { toEvaluateRiskResponse, toRiskDecisionResponse } from './risk.mapper';
import { evaluateRiskPolicy } from './risk.policy';

const RISK_PAYLOAD_SCHEMA_VERSION = 1;

export interface EvaluateRiskResult {
  readonly response: EvaluateRiskResponseDto;
  readonly replay: boolean;
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
  ) {}

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

    const { row, replay } = await this.dataSource.transaction(async (em) => {
      if (request.idempotencyKey !== undefined) {
        const existing = await em.findOne(RiskDecisionEntity, {
          where: { idempotencyKey: request.idempotencyKey },
          lock: { mode: 'pessimistic_write' },
        });
        if (existing !== null) {
          this.assertSameEvaluateRequest(existing, input);
          return { row: existing, replay: true };
        }
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

      return { row, replay: false };
    });

    return {
      replay,
      response: toEvaluateRiskResponse(this.entityToDomain(row)),
    };
  }

  private assertSameEvaluateRequest(
    row: RiskDecisionEntity,
    input: EvaluateRiskInput,
  ): void {
    const notionalMatches =
      Math.abs(Number(row.notionalUsd) - input.notionalUsd) < 1e-8;
    const same =
      row.correlationId === input.correlationId &&
      row.planReference === input.planReference &&
      row.snapshotVersion === input.snapshotVersion &&
      row.riskMode === input.riskMode &&
      notionalMatches;
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
