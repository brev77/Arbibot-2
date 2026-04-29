/**
 * DTO for DEX filter configuration
 * Matches the schema defined in docs/dex-filters-config-keys.md
 */

export class DexFilterValueDto {
  enabled!: boolean;
  value!: number;
}

export class DexFilterRangeDto {
  enabled!: boolean;
  min!: number;
  max!: number;
}

export class DexFilterListDto {
  enabled!: boolean;
  tokens!: string[];
}

export class DexFilterChainsDto {
  enabled!: boolean;
  chains!: string[];
}

export class DexFilterAssetsDto {
  enabled!: boolean;
  assets!: string[];
}

export class DexFilterRiskDto {
  enabled!: boolean;
  maxRiskLevel!: 'low' | 'medium' | 'high';
}

export class DexFiltersDto {
  minSpreadPct!: DexFilterValueDto;
  minProfitUsd!: DexFilterValueDto;
  maxFeesUsd!: DexFilterValueDto;
  volumeRange!: DexFilterRangeDto;
  blacklistTokens!: DexFilterListDto;
  allowedChains!: DexFilterChainsDto;
  quoteAssets!: DexFilterAssetsDto;
  highRisk!: DexFilterRiskDto;
}

export class DexFiltersConfigDto {
  enabled!: boolean;
  filters!: DexFiltersDto;
}
