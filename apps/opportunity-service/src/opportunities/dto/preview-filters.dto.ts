import { DexFiltersConfigDto } from './dex-filters-config.dto';

// Re-export for convenience
export type { DexFiltersConfigDto } from './dex-filters-config.dto';

export class PreviewFiltersDto implements DexFiltersConfigDto {
  enabled!: boolean;
  filters!: DexFiltersConfigDto['filters'];
}

export class FilterBreakdownDto {
  count!: number;
  percentage!: number;
}

export class FiltersPreviewDto {
  totalOpportunities!: number;
  filteredOut!: number;
  filteredPercentage!: number;
  breakdown!: {
    minSpreadPct: FilterBreakdownDto;
    minProfitUsd: FilterBreakdownDto;
    maxFeesUsd: FilterBreakdownDto;
    volumeRange: FilterBreakdownDto;
    blacklistTokens: FilterBreakdownDto;
    allowedChains: FilterBreakdownDto;
    quoteAssets: FilterBreakdownDto;
    highRisk: FilterBreakdownDto;
  };
}

export class FilterMetricsPeriodDto {
  totalOpportunities!: number;
  passedFilters!: number;
  rejectedByFilters!: number;
  breakdown!: {
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

export class FiltersMetricsDto {
  last1h!: FilterMetricsPeriodDto;
  last24h!: FilterMetricsPeriodDto;
  last7d!: FilterMetricsPeriodDto;
}
