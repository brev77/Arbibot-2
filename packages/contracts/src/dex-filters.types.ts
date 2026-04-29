/**
 * DEX Filters Types
 * Shared types for DEX opportunity filtering across backend and frontend
 * Schema defined in docs/dex-filters-config-keys.md
 */

export interface DexFilterValue {
  enabled: boolean;
  value: number;
}

export interface DexFilterRange {
  enabled: boolean;
  min: number;
  max: number;
}

export interface DexFilterList {
  enabled: boolean;
  tokens: string[];
}

export interface DexFilterChains {
  enabled: boolean;
  chains: string[];
}

export interface DexFilterAssets {
  enabled: boolean;
  assets: string[];
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface DexFilterRisk {
  enabled: boolean;
  maxRiskLevel: RiskLevel;
}

export interface DexFilters {
  minSpreadPct: DexFilterValue;
  minProfitUsd: DexFilterValue;
  maxFeesUsd: DexFilterValue;
  volumeRange: DexFilterRange;
  blacklistTokens: DexFilterList;
  allowedChains: DexFilterChains;
  quoteAssets: DexFilterAssets;
  highRisk: DexFilterRisk;
}

export interface DexFiltersConfig {
  enabled: boolean;
  filters: DexFilters;
}

export interface FilterBreakdown {
  count: number;
  percentage: number;
}

export interface FiltersPreview {
  totalOpportunities: number;
  filteredOut: number;
  filteredPercentage: number;
  breakdown: {
    minSpreadPct: FilterBreakdown;
    minProfitUsd: FilterBreakdown;
    maxFeesUsd: FilterBreakdown;
    volumeRange: FilterBreakdown;
    blacklistTokens: FilterBreakdown;
    allowedChains: FilterBreakdown;
    quoteAssets: FilterBreakdown;
    highRisk: FilterBreakdown;
  };
}

export interface FilterMetricsPeriod {
  totalOpportunities: number;
  passedFilters: number;
  rejectedByFilters: number;
  breakdown: {
    minSpreadPct: number;
    minProfitUsd: number;
    maxFeesUsd: number;
    volumeRange: number;
    blacklistTokens: number;
    allowedChains: number;
    quoteAssets: number;
    highRisk: number;
  };
}

export interface FiltersMetrics {
  last1h: FilterMetricsPeriod;
  last24h: FilterMetricsPeriod;
  last7d: FilterMetricsPeriod;
}

// Default values for DEX filters
export const DEFAULT_DEX_FILTERS_CONFIG: DexFiltersConfig = {
  enabled: true,
  filters: {
    minSpreadPct: { enabled: true, value: 0.5 },
    minProfitUsd: { enabled: true, value: 100 },
    maxFeesUsd: { enabled: true, value: 50 },
    volumeRange: { enabled: true, min: 10000, max: 1000000 },
    blacklistTokens: { enabled: false, tokens: [] },
    allowedChains: { enabled: false, chains: [] },
    quoteAssets: { enabled: true, assets: ['USDT', 'USDC', 'WETH', 'WBTC'] },
    highRisk: { enabled: true, maxRiskLevel: 'medium' },
  },
};