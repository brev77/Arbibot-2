import type {
  RiskDecisionOutcome,
  RiskMode,
} from '../domain/risk-decision';

export class RiskDecisionResponseDto {
  id!: string;

  correlationId!: string;

  planReference!: string;

  outcome!: RiskDecisionOutcome;

  reasons!: string[];

  notionalUsd!: number;

  snapshotVersion!: number;

  riskMode!: RiskMode;

  createdAtIso!: string;

  entityVersion!: number;
}
