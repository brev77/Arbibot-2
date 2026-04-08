import type { RiskDecisionOutcome } from '../domain/risk-decision';

export class RiskDecisionResponseDto {
  id!: string;

  correlationId!: string;

  planReference!: string;

  outcome!: RiskDecisionOutcome;

  reasons!: string[];

  snapshotVersion!: number;

  createdAtIso!: string;

  entityVersion!: number;
}
