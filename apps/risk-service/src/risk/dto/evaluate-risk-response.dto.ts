import type {
  RiskDecisionOutcome,
  RiskMode,
} from '../domain/risk-decision';

export class EvaluateRiskResponseDto {
  riskDecisionId!: string;

  outcome!: RiskDecisionOutcome;

  notionalUsd!: number;

  entityVersion!: number;

  riskMode!: RiskMode;
}
