import type { RiskDecision } from './domain/risk-decision';
import { EvaluateRiskResponseDto } from './dto/evaluate-risk-response.dto';
import { RiskDecisionResponseDto } from './dto/risk-decision-response.dto';

export function toEvaluateRiskResponse(
  decision: RiskDecision,
  outboxMessageId?: string,
): EvaluateRiskResponseDto {
  const dto = new EvaluateRiskResponseDto();
  dto.riskDecisionId = decision.id;
  if (outboxMessageId !== undefined) {
    dto.outboxMessageId = outboxMessageId;
  }
  dto.outcome = decision.outcome;
  dto.notionalUsd = decision.notionalUsd;
  dto.entityVersion = decision.entityVersion;
  dto.riskMode = decision.riskMode;
  return dto;
}

export function toRiskDecisionResponse(
  decision: RiskDecision,
): RiskDecisionResponseDto {
  const dto = new RiskDecisionResponseDto();
  dto.id = decision.id;
  dto.correlationId = decision.correlationId;
  dto.planReference = decision.planReference;
  dto.outcome = decision.outcome;
  dto.reasons = [...decision.reasons];
  dto.notionalUsd = decision.notionalUsd;
  dto.snapshotVersion = decision.snapshotVersion;
  dto.riskMode = decision.riskMode;
  dto.createdAtIso = decision.createdAtIso;
  dto.entityVersion = decision.entityVersion;
  return dto;
}
