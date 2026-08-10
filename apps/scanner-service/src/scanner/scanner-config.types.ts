/**
 * Type contract for `scanner.*` config-service values.
 *
 * These types mirror the zod schemas in apps/web/lib/policy-config-registry.ts
 * (scannerDefaultsSchema / scannerInstancesSchema / scannerFiltersSchema /
 * scannerVolumeRangeSchema). Both sides use `.strict()` in the UI, so unknown keys
 * are rejected — do not add fields here without updating the zod schema (and vice versa).
 *
 * Note: `interval_ms` is snake_case to match the zod schema (NOT camelCase).
 */

/** Volume range filter (opt-in, default OFF). */
export interface ScannerVolumeRangeJson {
  readonly enabled?: boolean;
  readonly min1hUsd?: number;
  readonly max24hUsd?: number;
}

/** Per-instance / per-default filters (AND-combined). */
export interface ScannerFiltersJson {
  readonly minSpreadBps?: number;
  /**
   * Minimum USD LIQUIDITY a V2 pool must hold to participate in a spread (PLAN13 #2).
   * V2 pools below this threshold (dead/abandoned pairs with negligible reserves) are
   * dropped BEFORE buy/sell selection, so their garbage price can't form a bogus spread.
   * V3 pools are exempt (their reserve fields hold `liquidity`, not real reserves).
   * NOTE: distinct from `minLiquidityUsd` below, which is a netProfit proxy, not reserves.
   * Requires SCANNER_NATIVE_USD env for WETH-quoted pairs (stablecoin quotes use 1.0).
   */
  readonly minPoolLiquidityUsd?: number;
  readonly minLiquidityUsd?: number;
  readonly volumeRange?: ScannerVolumeRangeJson;
  readonly blacklistTokens?: string[];
  readonly allowedChains?: number[];
  readonly quoteAssets?: string[];
}

/** JSON inside config-service `scanner.defaults` value (global/env/tenant scope). */
export interface ScannerDefaultsJson {
  readonly findingsRetentionDays?: number;
  readonly rpcRateLimitRps?: number;
  readonly poolCacheTtlMs?: number;
  readonly dedupCooldownMs?: number;
  readonly orphanRetryIntervalMs?: number;
  readonly orphanMaxAttempts?: number;
  readonly opportunityPublishTimeoutMs?: number;
  readonly defaultFilters?: ScannerFiltersJson;
}

/** A single scanner instance definition. */
export interface ScannerInstanceJson {
  /** Stable identifier; matches `scanner_instances.instance_id` runtime row. */
  readonly id: string;
  readonly name: string;
  /** Chain/network key, e.g. `arbitrum`, `base`, `bnb`. */
  readonly network: string;
  /** Strategy key, e.g. `2venue` (same-chain 2-venue) — Phase 2 MVP. */
  readonly strategy: string;
  /** Per-instance cycle interval in ms (snake_case to match zod schema). */
  readonly interval_ms: number;
  readonly filters?: ScannerFiltersJson;
  /** Whitelisted pool addresses this instance scans. */
  readonly poolWhitelist?: string[];
  readonly enabled: boolean;
}

/** JSON inside config-service `scanner.instances` value. */
export interface ScannerInstancesJson {
  readonly instances: ScannerInstanceJson[];
}

/**
 * Resolved defaults — env baseline merged with remote `scanner.defaults`.
 * Numeric fields are filled with constants from scanner-config.constants.ts.
 * Mutable: constructed by ScannerConfigService on each config refresh (env + remote merge).
 */
export interface ScannerDefaultsResolved {
  findingsRetentionDays: number;
  rpcRateLimitRps: number;
  poolCacheTtlMs: number;
  dedupCooldownMs: number;
  orphanRetryIntervalMs: number;
  orphanMaxAttempts: number;
  opportunityPublishTimeoutMs: number;
  defaultFilters: ScannerFiltersJson;
  configCacheTtlMs: number;
}

/** Resolved runtime config: defaults + the currently-known instance definitions. */
export interface ScannerResolvedConfig {
  defaults: ScannerDefaultsResolved;
  /** Enabled instances, with interval clamped to {@link MIN_SCANNER_INSTANCE_INTERVAL_MS}. */
  instances: ScannerInstanceJson[];
}
