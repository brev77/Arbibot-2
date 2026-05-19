/**
 * DEX configuration types matching migration 035 seed schema.
 * Step: DEX-FE-P3 — structured editors for dex.limits and dex.live.
 */

// ─── dex.limits ──────────────────────────────────────────────────────────────

export type DexChainLimits = {
  readonly enabled: boolean;
  readonly maxGasPriceGwei: number;
  readonly maxPriorityFeeGwei: number;
  readonly maxGasPerTradeGwei: number;
  readonly maxNotionalPerTradeUsd: number;
};

export type DexLimitsConfig = {
  readonly enabled: boolean;
  readonly maxNotionalPerTradeUsd: number;
  readonly maxDailyNotionalUsd: number;
  readonly maxOpenPositions: number;
  readonly maxSlippageBps: number;
  readonly chains: Readonly<Record<string, DexChainLimits>>;
  readonly killSwitch: boolean;
  readonly requireTwoPersonApproval: boolean;
  readonly requireOperatorApprovalPerTrade: boolean;
};

export const DEFAULT_DEX_LIMITS: DexLimitsConfig = {
  enabled: false,
  maxNotionalPerTradeUsd: 500,
  maxDailyNotionalUsd: 5000,
  maxOpenPositions: 3,
  maxSlippageBps: 50,
  chains: {
    '42161': {
      enabled: false,
      maxGasPriceGwei: 30,
      maxPriorityFeeGwei: 1,
      maxGasPerTradeGwei: 5000000,
      maxNotionalPerTradeUsd: 500,
    },
  },
  killSwitch: false,
  requireTwoPersonApproval: true,
  requireOperatorApprovalPerTrade: true,
};

// ─── dex.live ────────────────────────────────────────────────────────────────

export type DexLiveConfig = {
  readonly liveEnabled: boolean;
  readonly paperParallelEnabled: boolean;
  readonly chains: ReadonlyArray<string>;
  readonly maxPositionDurationMinutes: number;
  readonly autoHedgeEnabled: boolean;
  readonly autoUnwindEnabled: boolean;
  readonly dryRunMode: boolean;
  readonly auditAllTrades: boolean;
};

export const DEFAULT_DEX_LIVE: DexLiveConfig = {
  liveEnabled: false,
  paperParallelEnabled: true,
  chains: ['42161'],
  maxPositionDurationMinutes: 60,
  autoHedgeEnabled: false,
  autoUnwindEnabled: false,
  dryRunMode: true,
  auditAllTrades: true,
};