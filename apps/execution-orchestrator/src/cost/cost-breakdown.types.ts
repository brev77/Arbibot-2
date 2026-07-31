/**
 * Pre-trade cost breakdown types.
 *
 * A `PlanCostBreakdown` aggregates all monetary losses a multi-leg execution
 * plan is expected to incur BEFORE it is broadcast: gas (EIP-1559 fee × gas
 * limit × native/USD), slippage (price impact on pool reserves), pool fees
 * (DEX protocol fees, e.g. UniV2 0.3%) and bridge fees (relayer + protocol
 * cost for cross-chain legs).
 *
 * Single-writer: execution-orchestrator (TradeCostEstimatorService). Persisted
 * on `ExecutionPlanEntity.costBreakdown` (jsonb, migration 048) and as typed
 * columns on `ExecutionLegEntity`. Risk-service and capital-service never write
 * these fields — they receive the gate decision from execution.
 *
 * The net profit (`grossProfitUsd − totalCostUsd`) is the value the plan-level
 * pre-trade gate checks against `dex.limits.minNetProfitUsd` to block
 * unprofitable plans before the first leg is submitted.
 */

/**
 * Confidence of a per-leg cost estimate.
 *
 * - `exact`: all components resolved from on-chain / live sources (gas limit
 *   via `estimateGas`, pool reserves for slippage, pool fee tier, bridge fee).
 * - `modeled`: at least one component used a fallback model (e.g. slippage
 *   derived from the default `slippageBps` override instead of pool reserves).
 * - `unavailable`: a required source was missing (no RPC, no price feed). For
 *   live legs this fails-closed in the gate; the breakdown is still recorded
 *   for observability.
 */
export type EstimateConfidence = 'exact' | 'modeled' | 'unavailable';

/**
 * Cost breakdown for a single execution leg (DEX swap or bridge transfer).
 */
export interface LegCostBreakdown {
  /** Leg index within the plan (`playbookConfig.legs[]`). */
  readonly legIndex: number;
  /** Leg type discriminator. */
  readonly legType: 'dex' | 'bridge';
  /** Chain the leg executes on (source chain for bridge legs). */
  readonly chainId: number;
  /** Estimated gas cost in USD (gas limit × EIP-1559 fee × native/USD). 0 for legs with no on-chain tx. */
  readonly gasUsd: number;
  /** Estimated slippage cost in USD (price impact bps × notional / 10000). DEX legs only. */
  readonly slippageCostUsd: number;
  /** Pool / protocol fee in USD (feeBps × notional / 10000). DEX legs only. */
  readonly poolFeeUsd: number;
  /** Bridge relayer + protocol fee in USD (bridge legs only). */
  readonly bridgeFeeUsd: number;
  /** Sum of the four components above. */
  readonly totalCostUsd: number;
  /** Estimated slippage in basis points (recorded separately for metrics/alerting). DEX legs only. */
  readonly slippageBps: number;
  /** Overall estimate confidence for this leg. */
  readonly estimateConfidence: EstimateConfidence;
  /** Human-readable note when a component used a fallback or was unavailable. */
  readonly note?: string;
}

/**
 * Aggregated cost breakdown for an entire multi-leg execution plan.
 *
 * Stored as `cost_breakdown` jsonb on `execution_plans` (migration 048) so it
 * survives restarts and is queryable for post-trade reconciliation.
 */
export interface PlanCostBreakdown {
  /** Schema version for forward compatibility. */
  readonly schemaVersion: 1;
  /** ISO timestamp when the estimate was computed. */
  readonly estimatedAt: string;
  /** Per-leg breakdowns in leg order. */
  readonly legs: ReadonlyArray<LegCostBreakdown>;
  /** Sum of `legs[].gasUsd`. */
  readonly totalGasUsd: number;
  /** Sum of `legs[].slippageCostUsd`. */
  readonly totalSlippageUsd: number;
  /** Sum of `legs[].poolFeeUsd`. */
  readonly totalPoolFeeUsd: number;
  /** Sum of `legs[].bridgeFeeUsd`. */
  readonly totalBridgeFeeUsd: number;
  /** Sum of all cost components across all legs. */
  readonly totalCostUsd: number;
  /** Gross profit (USD) sourced from the opportunity payload, or null when unknown. */
  readonly grossProfitUsd: number | null;
  /** Net profit = grossProfitUsd − totalCostUsd, or null when gross is unknown. */
  readonly netProfitUsd: number | null;
  /** Overall plan estimate confidence — `unavailable` if ANY leg is unavailable. */
  readonly estimateConfidence: EstimateConfidence;
}

/**
 * Result of a plan-level pre-trade gate decision.
 */
export interface CostGateDecision {
  /** Whether the plan is allowed to proceed to submit. */
  readonly allowed: boolean;
  /** Reasons the plan was blocked (empty when allowed). */
  readonly reasons: ReadonlyArray<string>;
  /** Warnings (non-blocking, e.g. modeled confidence). */
  readonly warnings: ReadonlyArray<string>;
  /** The breakdown that produced the decision. */
  readonly breakdown: PlanCostBreakdown;
}
