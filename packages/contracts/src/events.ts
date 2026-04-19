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
  legFilled: 'LegFilled',
  planCompleted: 'PlanCompleted',
  opportunityDetected: 'OpportunityDetected',
  snapshotUpdated: 'SnapshotUpdated',
  paperPromotionCandidateRequested: 'PaperPromotionCandidateRequested',
} as const;

/** Outbox `schema_version` / envelope `version` for PaperPromotionCandidateRequested (opportunity-service → relay → paper HTTP). */
export const PAPER_PROMOTION_CANDIDATE_REQUESTED_PAYLOAD_SCHEMA_VERSION = 1 as const;

export type PaperPromotionCandidateRequestedPayloadV1 = {
  readonly opportunityId: string;
  readonly instrumentKey: string;
  readonly source: string;
  readonly enqueueIdempotencyKey: string;
  readonly score?: number;
  readonly driftBps?: number;
  readonly evidence: Record<string, unknown>;
};

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

export type SnapshotUpdatedPayloadV1 = {
  readonly snapshotId: string;
  readonly venueCode: string;
  readonly venueSymbol: string;
  readonly observedAt: string;
  readonly canonicalInstrumentId?: string;
  readonly bid?: number;
  readonly ask?: number;
  readonly last?: number;
};

export type SnapshotUpdatedEnvelopeV1 = EventEnvelope<SnapshotUpdatedPayloadV1>;

/** SnapshotUpdated outbox/Kafka payload schema version 2 (market-intake-service). */
export type SnapshotUpdatedPayloadV2 = {
  readonly snapshotId: string;
  readonly venueCode: string;
  readonly venueSymbol: string;
  readonly observedAt: string;
  readonly receivedAt: string;
  readonly entityVersion: number;
  readonly staleAfterSeconds: number | null;
  readonly payload: Record<string, unknown>;
  readonly canonicalInstrumentId?: string;
  readonly bid?: number;
  readonly ask?: number;
  readonly last?: number;
};

export type SnapshotUpdatedEnvelopeV2 = EventEnvelope<SnapshotUpdatedPayloadV2>;

/** Outbox / envelope `version` and `outbox_events.schema_version` for CapitalReserved. */
export const CAPITAL_RESERVED_PAYLOAD_SCHEMA_VERSION = 1 as const;

export type CapitalReservedPayloadV1 = {
  readonly reservationId: string;
  readonly correlationId: string;
  readonly planId: string | null;
  readonly amountUsd: number;
  readonly expiresAt: string;
  readonly entityVersion: number;
};

export type CapitalReservedEnvelopeV1 = EventEnvelope<CapitalReservedPayloadV1>;

/** Outbox / envelope `version` and `outbox_events.schema_version` for PlanArmed. */
export const PLAN_ARMED_PAYLOAD_SCHEMA_VERSION = 1 as const;

export type PlanArmedPayloadV1 = {
  readonly planId: string;
  readonly state: 'armed';
  readonly capitalReservationId: string;
  readonly riskDecisionId: string | null;
  readonly entityVersion: number;
};

export type PlanArmedEnvelopeV1 = EventEnvelope<PlanArmedPayloadV1>;

/** Outbox / envelope `version` and `outbox_events.schema_version` for LegFilled. */
export const LEG_FILLED_PAYLOAD_SCHEMA_VERSION = 1 as const;

export type LegFilledPayloadV1 = {
  readonly legId: string;
  readonly planId: string;
  readonly state: 'filled';
  readonly filledQuantity: number;
  readonly entityVersion: number;
};

export type LegFilledEnvelopeV1 = EventEnvelope<LegFilledPayloadV1>;

/** Outbox / envelope `version` and `outbox_events.schema_version` for PlanCompleted. */
export const PLAN_COMPLETED_PAYLOAD_SCHEMA_VERSION = 1 as const;

export type PlanCompletedPayloadV1 = {
  readonly planId: string;
  readonly state: 'completed';
  readonly entityVersion: number;
  readonly capitalReservationId: string | null;
};

export type PlanCompletedEnvelopeV1 = EventEnvelope<PlanCompletedPayloadV1>;
