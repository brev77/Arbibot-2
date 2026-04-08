import type { RiskDecisionOutcome } from '../domain/risk-decision';

export class EvaluateRiskResponseDto {
  riskDecisionId!: string;

  outcome!: RiskDecisionOutcome;

  entityVersion!: number;
}
