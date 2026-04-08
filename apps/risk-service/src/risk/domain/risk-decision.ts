/** Domain outcome for a persisted risk decision (Phase 0 — no live execution). */
export type RiskDecisionOutcome = 'approved' | 'rejected' | 'deferred';

/**
 * Single-writer domain aggregate: only {@link RiskService} constructs instances.
 */
export interface RiskDecision {
  readonly id: string;
  readonly correlationId: string;
  readonly planReference: string;
  readonly outcome: RiskDecisionOutcome;
  readonly reasons: readonly string[];
  readonly snapshotVersion: number;
  readonly createdAtIso: string;
  readonly entityVersion: number;
}

export interface EvaluateRiskInput {
  readonly correlationId: string;
  readonly planReference: string;
  readonly notionalUsd: number;
  readonly snapshotVersion: number;
}
