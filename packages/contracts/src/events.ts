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
  dexTransactionSubmitted: 'DexTransactionSubmitted',
  dexTransactionConfirmed: 'DexTransactionConfirmed',
  dexTransactionFailed: 'DexTransactionFailed',
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
export const LEG_FILLED_PAYLOAD_SCHEMA_VERSION = 2 as const;

export type LegFilledPayloadV1 = {
  readonly legId: string;
  readonly planId: string;
  readonly state: 'filled';
  readonly filledQuantity: number;
  readonly entityVersion: number;
};

/** DEX on-chain metadata attached to LegFilled when fill originated from a DEX swap. */
export type DexFillMetadata = {
  readonly txHash: string;
  readonly chainId: number;
  readonly gasUsed: string | null;
  readonly effectiveGasPrice: string | null;
  readonly blockNumber: number | null;
  readonly fromAddress: string | null;
  readonly toAddress: string | null;
};

/** LegFilled v2 payload — extends v1 with optional DEX on-chain metadata. */
export type LegFilledPayloadV2 = LegFilledPayloadV1 & {
  readonly dex?: DexFillMetadata;
};

export type LegFilledEnvelopeV1 = EventEnvelope<LegFilledPayloadV1>;
export type LegFilledEnvelopeV2 = EventEnvelope<LegFilledPayloadV2>;

/** Outbox / envelope `version` and `outbox_events.schema_version` for PlanCompleted. */
export const PLAN_COMPLETED_PAYLOAD_SCHEMA_VERSION = 1 as const;

export type PlanCompletedPayloadV1 = {
  readonly planId: string;
  readonly state: 'completed';
  readonly entityVersion: number;
  readonly capitalReservationId: string | null;
};

export type PlanCompletedEnvelopeV1 = EventEnvelope<PlanCompletedPayloadV1>;

// ---------------------------------------------------------------------------
// DEX Transaction outbox events (DEX-1-2-OUTBOX-EVENTS)
// ---------------------------------------------------------------------------

/** Outbox `schema_version` / envelope `version` for DexTransaction events. */
export const DEX_TRANSACTION_PAYLOAD_SCHEMA_VERSION = 1 as const;

/** DexTransactionSubmitted — emitted when a DEX tx is submitted to the mempool. */
export type DexTransactionSubmittedPayloadV1 = {
  readonly txHash: string;
  readonly chainId: number;
  readonly legId: string | null;
  readonly planId: string | null;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly value: string;
  readonly gasLimit: string;
  readonly nonce: number | null;
  readonly submittedAt: string;
};

export type DexTransactionSubmittedEnvelopeV1 = EventEnvelope<DexTransactionSubmittedPayloadV1>;

/** DexTransactionConfirmed — emitted when a DEX tx is confirmed on-chain. */
export type DexTransactionConfirmedPayloadV1 = {
  readonly txHash: string;
  readonly chainId: number;
  readonly legId: string | null;
  readonly planId: string | null;
  readonly blockNumber: number | null;
  readonly gasUsed: string | null;
  readonly effectiveGasPrice: string | null;
  readonly confirmations: number;
  readonly confirmedAt: string;
};

export type DexTransactionConfirmedEnvelopeV1 = EventEnvelope<DexTransactionConfirmedPayloadV1>;

/** DexTransactionFailed — emitted when a DEX tx fails or reverts on-chain. */
export type DexTransactionFailedPayloadV1 = {
  readonly txHash: string;
  readonly chainId: number;
  readonly legId: string | null;
  readonly planId: string | null;
  readonly blockNumber: number | null;
  readonly gasUsed: string | null;
  readonly effectiveGasPrice: string | null;
  readonly revertReason: string | null;
  readonly errorMessage: string | null;
  readonly failedAt: string;
};

export type DexTransactionFailedEnvelopeV1 = EventEnvelope<DexTransactionFailedPayloadV1>;
