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

/**
 * Outbox `schema_version` / envelope `version` for PaperPromotionCandidateRequested
 * (opportunity-service → relay → paper HTTP).
 *
 * Schema is additive: v1 carried the core fields; the optional P/L fields (`netProfitUsd`,
 * `spreadBps`, `buyVenue`, `sellVenue`) were added so the AutoDriveWorker in
 * paper-trading-service can settle a paper trade WITHOUT a synchronous HTTP re-fetch of the
 * opportunity (which would create a paper→live runtime coupling). Old producers/consumers
 * that omit them remain compatible; consumers must treat all P/L fields as optional.
 */
export const PAPER_PROMOTION_CANDIDATE_REQUESTED_PAYLOAD_SCHEMA_VERSION = 1 as const;

export type PaperPromotionCandidateRequestedPayloadV1 = {
  readonly opportunityId: string;
  readonly instrumentKey: string;
  readonly source: string;
  readonly enqueueIdempotencyKey: string;
  readonly score?: number;
  readonly driftBps?: number;
  readonly evidence: Record<string, unknown>;
  /** Net (post-fee, pre-slippage) opportunity profit in USD — copied from the opportunity payload for paper settle. */
  readonly netProfitUsd?: number;
  /** Cross-venue spread in basis points — copied from the opportunity payload for paper settle. */
  readonly spreadBps?: number;
  /** Buy venue key (e.g. 'uniswap-v2') — copied from the opportunity payload for paper settle. */
  readonly buyVenue?: string;
  /** Sell venue key — copied from the opportunity payload for paper settle. */
  readonly sellVenue?: string;
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

// ---------------------------------------------------------------------------
// OpportunityDetected outbox event (Phase 3b — opportunity-service.create())
// ---------------------------------------------------------------------------
// Today `opportunityDetected` in EVENT_NAMES is dead code (no payload schema, no producer).
// This schema materializes the contract. Producer = opportunity-service.create() after
// scanner-service (or any detector) POSTs a rich payload. Consumers: observability (Hermes,
// UI async), future auto-enricher. NOTE: this event does NOT drive lifecycle detected→
// risk_checked (that requires RiskDecisionIssued via request-risk-evaluation — separate flow).

/** Outbox `schema_version` / envelope `version` for OpportunityDetected. */
export const OPPORTUNITY_DETECTED_PAYLOAD_SCHEMA_VERSION = 1 as const;

/** `sourceModule` indicating the opportunity was discovered by scanner-service. */
export const OPPORTUNITY_SOURCE_SCANNER = 'scanner-service' as const;

export type OpportunityDetectedPayloadV1 = {
  readonly opportunityId: string;
  /** Canonical instrument key (e.g. `arb:{chain}:{PAIR}`). May be absent for non-canonical sources. */
  readonly instrumentKey: string | null;
  /** Canonical route key. May be absent for non-canonical sources. */
  readonly routeKey: string | null;
  /** Originating module that fed the opportunity (e.g. 'scanner-service', 'manual', 'paper-discovery'). */
  readonly sourceModule: string;
  /** Cross-venue spread in basis points (null if not a cross-DEX opportunity). */
  readonly spreadBps: number | null;
  readonly grossProfitUsd: number | null;
  readonly netProfitUsd: number | null;
  readonly feesUsd: number | null;
  /** Observed market volume in USD over the filter window (null if not measured). */
  readonly volumeUsd: number | null;
  /** Buy venue key (e.g. 'uniswap-v2') for cross-DEX opportunities. */
  readonly buyVenue: string | null;
  readonly sellVenue: string | null;
  readonly chainId: number | null;
  readonly token: string | null;
  readonly quoteAsset: string | null;
  /** Free-form evidence block (pool addresses, reserves, gas estimate, etc.). */
  readonly evidence: Record<string, unknown>;
};

export type OpportunityDetectedEnvelopeV1 = EventEnvelope<OpportunityDetectedPayloadV1>;
