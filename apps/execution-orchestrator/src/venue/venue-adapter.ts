import type { ExecutionLegEntity, ExecutionPlanEntity } from '@arbibot/persistence';

/**
 * Optional on-chain metadata returned by DEX adapters after broadcast +
 * confirmation (P9-2). When present, the orchestrator persists an
 * OnChainTransaction row so fill enrichment, reconciliation, and audit have a
 * durable on-chain proof. Absent for HTTP/mock venues (paper/legacy legs).
 */
export interface VenueOnChainMeta {
  readonly txHash: string;
  readonly chainId: number;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly nonce?: number;
  readonly gasLimit?: string;
  readonly gasUsed?: string | null;
  readonly gasPrice?: string | null;
  readonly maxFeePerGas?: string | null;
  readonly maxPriorityFeePerGas?: string | null;
  readonly blockNumber?: number | null;
  readonly blockHash?: string | null;
  readonly transactionIndex?: number | null;
  readonly value?: string;
  readonly status: 'confirmed' | 'failed' | 'reverted';
  readonly revertReason?: string | null;
}

export type VenueLegSubmitResult = {
  readonly externalOrderId: string;
  /**
   * P9-2: on-chain proof for DEX legs. The orchestrator persists this via
   * OnChainTransactionService in the same tx as the leg `submitting → sent`
   * transition. Legacy/mock venues omit it.
   */
  readonly onChain?: VenueOnChainMeta;
};

/** Terminal leg states after a venue refuses or aborts submission (no `sent`). */
export type VenueLegTerminalState = 'rejected' | 'timedOut' | 'failed';

/** Recoverable submit failure: leg stays `created`; caller may retry `mark-sent`. */
export class VenueSubmitTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VenueSubmitTransientError';
  }
}

/**
 * Taxonomy for HTTP 4xx from lab / per-venue HTTP fronts (observability + operator logs).
 * Optional `venueErrorCode` may be returned in JSON for per-venue mapping.
 */
export type VenueHttpClientErrorCategory =
  | 'validation'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'semantic'
  | 'rate_limited'
  | 'client_other';

/** Venue or contract rejected the submit; do not retry `mark-sent` with the same payload. */
export class VenueSubmitClientError extends Error {
  constructor(
    message: string,
    public readonly meta?: {
      readonly httpStatus?: number;
      readonly category?: VenueHttpClientErrorCategory;
      readonly venueErrorCode?: string;
    },
  ) {
    super(message);
    this.name = 'VenueSubmitClientError';
  }
}

/** Non-recoverable submit outcome: leg moves to `rejected` | `timedOut` | `failed` in the same transaction. */
export class VenueTerminalSubmitError extends Error {
  constructor(
    message: string,
    public readonly terminalState: VenueLegTerminalState,
  ) {
    super(message);
    this.name = 'VenueTerminalSubmitError';
  }
}

/**
 * Phase 2 venue boundary: first wave uses a mock/sandbox implementation (`P2-2.1-VEN`).
 * Live CEX/DEX adapters replace the binding without changing orchestrator invariants.
 */
export interface VenueAdapter {
  submitLeg(
    plan: ExecutionPlanEntity,
    leg: ExecutionLegEntity,
  ): Promise<VenueLegSubmitResult>;
}

export const VENUE_ADAPTER = Symbol('VENUE_ADAPTER');
