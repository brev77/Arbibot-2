/** Async envelope fields (mirror docs/async-events.md + JSON Schema). */
export interface EventEnvelope<TPayload extends Record<string, unknown>> {
  readonly messageId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly version: number;
  readonly sourceModule: string;
  readonly eventTs: string;
  readonly eventName: string;
  readonly payload: TPayload;
}

export const EVENT_NAMES = {
  riskDecisionIssued: 'RiskDecisionIssued',
  capitalReserved: 'CapitalReserved',
  planArmed: 'PlanArmed',
  opportunityDetected: 'OpportunityDetected',
} as const;

export type RiskDecisionIssuedPayloadV1 = {
  readonly decisionId: string;
  readonly outcome: 'approved' | 'rejected' | 'deferred';
  readonly planReference: string;
  readonly notionalUsd: number;
  readonly snapshotVersion: number;
  readonly riskMode: 'fast' | 'standard' | 'conservative';
  readonly reasons: readonly string[];
};

export type RiskDecisionIssuedEnvelopeV1 = EventEnvelope<RiskDecisionIssuedPayloadV1>;
