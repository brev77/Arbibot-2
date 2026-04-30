// Query key factory for DEX filters

export const dexFiltersKeys = {
  config: (environment?: string, tenantId?: string) => 
    ['dex-filters', 'config', environment, tenantId] as const,
  preview: () => ['dex-filters', 'preview'] as const,
  metrics: () => ['dex-filters', 'metrics'] as const,
  all: () => ['dex-filters'] as const,
};