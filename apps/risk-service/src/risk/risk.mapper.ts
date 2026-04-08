import type { RiskDecision } from './domain/risk-decision';
import { EvaluateRiskResponseDto } from './dto/evaluate-risk-response.dto';
import { RiskDecisionResponseDto } from './dto/risk-decision-response.dto';

export function toEvaluateRiskResponse(
  decision: RiskDecision,
): EvaluateRiskResponseDto {
  const dto = new EvaluateRiskResponseDto();
  dto.riskDecisionId = decision.id;
  dto.outcome = decision.outcome;
  dto.entityVersion = decision.entityVersion;
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
  dto.snapshotVersion = decision.snapshotVersion;
  dto.createdAtIso = decision.createdAtIso;
  dto.entityVersion = decision.entityVersion;
  return dto;
}
