/**
 * Bridge adapter interface for cross-chain transfers.
 *
 * Step: DEX-2-1-BRIDGE-ACROSS
 *
 * Alongside `VenueAdapter`, bridge adapters handle cross-chain transfers
 * between EVM chains. The interface abstracts bridge-specific logic
 * (submission, status tracking, fee estimation).
 *
 * Implementations: AcrossBridgeAdapter, StargateBridgeAdapter, NativeBridgeAdapter.
 */

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

/** Parameters for a bridge transfer. */
export interface BridgeTransferParams {
  /** Source chain ID. */
  readonly sourceChainId: number;
  /** Destination chain ID. */
  readonly destinationChainId: number;
  /** Token address on the source chain. */
  readonly token: string;
  /** Token address on the destination chain (may differ for wrapped tokens). */
  readonly destinationToken: string;
  /** Amount in smallest token units. */
  readonly amount: bigint;
  /** Recipient wallet address on the destination chain. */
  readonly recipientAddress: string;
  /** Deterministic idempotency key for deduplication. */
  readonly idempotencyKey: string;
}

/** Result of a successful bridge transfer submission. */
export interface BridgeSubmitResult {
  /** TX hash on the source chain. */
  readonly sourceTxHash: string;
  /** Source chain ID. */
  readonly sourceChainId: number;
  /** Destination chain ID. */
  readonly destinationChainId: number;
  /** Bridge-specific transfer ID for tracking. */
  readonly bridgeId: string;
  /** Estimated relay time in milliseconds. */
  readonly estimatedRelayMs: number;
}

/** Current status of a bridge transfer. */
export interface BridgeStatusResult {
  /** Aggregated status. */
  readonly status: 'pending' | 'relaying' | 'confirming' | 'completed' | 'failed';
  /** TX hash on source chain. */
  readonly sourceTxHash: string;
  /** TX hash on destination chain (null until relay completes). */
  readonly destinationTxHash: string | null;
  /** Number of confirmations on the destination chain. */
  readonly confirmations: number;
  /** Estimated time until completion in ms. */
  readonly estimatedCompletionMs: number;
}

/** Fee estimation for a bridge transfer. */
export interface BridgeFeeEstimate {
  /** Bridge fee in wei (native token on source chain). */
  readonly bridgeFee: bigint;
  /** Relayer fee in wei (if applicable). */
  readonly relayerFee: bigint;
  /** Estimated gas cost on source chain in wei. */
  readonly estimatedGasSource: bigint;
  /** Estimated gas cost on destination chain in wei (for claim TX if needed). */
  readonly estimatedGasDestination: bigint;
  /** Total estimated cost in USD. */
  readonly totalEstimatedCostUsd: number;
}

// ───────────────────────────────────────────────────────────────────────
// Interface
// ───────────────────────────────────────────────────────────────────────

/**
 * Bridge adapter — abstracts cross-chain bridge interactions.
 *
 * Implementations must be stateless and thread-safe.
 * All state is persisted in `bridge_transfers` table by `BridgeTransferService`.
 */
export interface BridgeAdapter {
  /** Unique bridge identifier (e.g. 'across', 'stargate', 'native-arb'). */
  readonly bridgeKey: string;

  /** Supported chain pairs: [sourceChainId, destinationChainId][]. */
  readonly supportedChains: ReadonlyArray<readonly [number, number]>;

  /**
   * Submit a bridge transfer on the source chain.
   *
   * Must be idempotent: if called again with the same `idempotencyKey`,
   * return the existing result without re-submitting.
   */
  submitBridgeTransfer(params: BridgeTransferParams): Promise<BridgeSubmitResult>;

  /**
   * Check the current status of a bridge transfer.
   *
   * Polled by `BridgeTransferService` during the relay lifecycle.
   */
  checkBridgeStatus(bridgeId: string): Promise<BridgeStatusResult>;

  /**
   * Estimate the total fee for a bridge transfer.
   */
  estimateBridgeFee(params: BridgeTransferParams): Promise<BridgeFeeEstimate>;

  /**
   * Estimate relay time in milliseconds for a given transfer.
   */
  estimateRelayTime(params: BridgeTransferParams): Promise<number>;
}

/** DI token for bridge adapter registration. */
export const BRIDGE_ADAPTER = Symbol('BRIDGE_ADAPTER');