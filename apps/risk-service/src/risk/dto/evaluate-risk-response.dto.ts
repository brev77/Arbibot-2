import type {
  RiskDecisionOutcome,
  RiskMode,
} from '../domain/risk-decision';

export class EvaluateRiskResponseDto {
  riskDecisionId!: string;

  /** Outbox `message_id` for RiskDecisionIssued (absent on idempotent replay). */
  outboxMessageId?: string;

  outcome!: RiskDecisionOutcome;

  notionalUsd!: number;

  entityVersion!: number;

  riskMode!: RiskMode;
}
