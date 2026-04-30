import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  DexFiltersConfig,
  FiltersPreview,
  FiltersMetrics,
} from '@arbibot/contracts';
import { dexFiltersKeys } from './dex-filters-query-keys';

/**
 * Fetch DEX filters configuration from config-service
 */
export function useDexFiltersConfig(
  environment?: string,
  tenantId?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: dexFiltersKeys.config(environment, tenantId),
    queryFn: async () => {
      const queryParams = new URLSearchParams();
      queryParams.append('effective', 'true');
      if (environment) queryParams.append('environment', environment);
      if (tenantId) queryParams.append('tenantId', tenantId);

      const response = await fetch(
        `/api/operator/settings/configurations/dex.filters?${queryParams}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch DEX filters configuration');
      }

      const data = await response.json();
      return data.configValue as DexFiltersConfig;
    },
    enabled,
    staleTime: 30_000, // 30 seconds
  });
}

/**
 * Update DEX filters configuration
 */
export function useUpdateDexFiltersConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      config,
      environment,
      tenantId,
    }: {
      config: DexFiltersConfig;
      environment?: string;
      tenantId?: string;
    }) => {
      const queryParams = new URLSearchParams();
      if (environment) queryParams.append('environment', environment);
      if (tenantId) queryParams.append('tenantId', tenantId);

      const response = await fetch(
        `/api/operator/settings/configurations/dex.filters?${queryParams}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(config),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update DEX filters configuration');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate config queries
      void queryClient.invalidateQueries({ queryKey: dexFiltersKeys.config() });
    },
  });
}

/**
 * Preview DEX filters impact on existing opportunities
 */
export function usePreviewDexFilters() {
  return useMutation({
    mutationFn: async (filters: DexFiltersConfig) => {
      const response = await fetch('/api/operator/opportunities/preview-filters', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(filters),
      });

      if (!response.ok) {
        throw new Error('Failed to preview DEX filters');
      }

      return response.json() as Promise<FiltersPreview>;
    },
  });
}

/**
 * Fetch DEX filters metrics
 */
export function useDexFiltersMetrics(enabled = true) {
  return useQuery({
    queryKey: dexFiltersKeys.metrics(),
    queryFn: async () => {
      const response = await fetch('/api/operator/opportunities/metrics/dex-filters');

      if (!response.ok) {
        throw new Error('Failed to fetch DEX filters metrics');
      }

      return response.json() as Promise<FiltersMetrics>;
    },
    enabled,
    staleTime: 60_000, // 1 minute
    refetchInterval: 60_000, // Refetch every minute
  });
}