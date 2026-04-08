import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type {
  EvaluateRiskInput,
  RiskDecision,
  RiskDecisionOutcome,
} from './domain/risk-decision';
import type { EvaluateRiskRequestDto } from './dto/evaluate-risk-request.dto';
import type { EvaluateRiskResponseDto } from './dto/evaluate-risk-response.dto';
import type { RiskDecisionResponseDto } from './dto/risk-decision-response.dto';
import { toEvaluateRiskResponse, toRiskDecisionResponse } from './risk.mapper';

/** Phase 0 cap for deterministic stub policy (no live execution). */
const NOTIONAL_APPROVAL_THRESHOLD_USD = 1_000_000;

/**
 * Single-writer for risk decisions: all persisted decisions are created here.
 */
@Injectable()
export class RiskService {
  private readonly decisions = new Map<string, RiskDecision>();

  evaluateRisk(request: EvaluateRiskRequestDto): EvaluateRiskResponseDto {
    const input: EvaluateRiskInput = {
      correlationId: request.correlationId,
      planReference: request.planReference,
      notionalUsd: request.notionalUsd,
      snapshotVersion: request.snapshotVersion,
    };
    const decision = this.createDecision(input);
    this.decisions.set(decision.id, decision);
    return toEvaluateRiskResponse(decision);
  }

  getRiskDecision(id: string): RiskDecisionResponseDto {
    const decision = this.decisions.get(id);
    if (decision === undefined) {
      throw new NotFoundException(`Risk decision not found: ${id}`);
    }
    return toRiskDecisionResponse(decision);
  }

  private createDecision(input: EvaluateRiskInput): RiskDecision {
    const id = randomUUID();
    const createdAtIso = new Date().toISOString();
    const { outcome, reasons } = this.evaluatePolicy(input);
    return {
      id,
      correlationId: input.correlationId,
      planReference: input.planReference,
      outcome,
      reasons,
      snapshotVersion: input.snapshotVersion,
      createdAtIso,
      entityVersion: 1,
    };
  }

  private evaluatePolicy(input: EvaluateRiskInput): {
    outcome: RiskDecisionOutcome;
    reasons: readonly string[];
  } {
    if (input.notionalUsd > NOTIONAL_APPROVAL_THRESHOLD_USD) {
      return {
        outcome: 'rejected',
        reasons: [
          `Notional ${input.notionalUsd} exceeds Phase 0 threshold ${NOTIONAL_APPROVAL_THRESHOLD_USD}`,
        ],
      };
    }
    return {
      outcome: 'approved',
      reasons: ['Phase 0 stub: within notional threshold'],
    };
  }
}
