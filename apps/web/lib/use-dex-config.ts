/**
 * React Query hooks for DEX configuration (dex.limits, dex.live).
 * Reads via config-service BFF, writes via PUT with audit.
 * Step: DEX-FE-P3.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { operatorKeys } from './operator-query-keys';
import type { DexLimitsConfig, DexLiveConfig } from './dex-config-types';
import { DEFAULT_DEX_LIMITS, DEFAULT_DEX_LIVE } from './dex-config-types';

/* ─── dex.limits ───────────────────────────────────────────────────────────── */

export function useDexLimits(environment?: string, tenantId?: string) {
  return useQuery({
    queryKey: operatorKeys.dexLimits(),
    queryFn: async (): Promise<DexLimitsConfig> => {
      const params = new URLSearchParams();
      params.append('effective', 'true');
      if (environment) params.append('environment', environment);
      if (tenantId) params.append('tenantId', tenantId);

      const res = await fetch(
        `/api/operator/settings/configurations/dex.limits?${params}`,
      );
      if (!res.ok) return DEFAULT_DEX_LIMITS;
      const data = await res.json();
      return (data.configValue as DexLimitsConfig) ?? DEFAULT_DEX_LIMITS;
    },
    staleTime: 30_000,
  });
}

export function useUpdateDexLimits() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      config,
      approveReason,
    }: {
      config: DexLimitsConfig;
      approveReason?: string;
    }) => {
      const body: Record<string, unknown> = {
        configValue: JSON.stringify(config),
        operatorId: 'operator-ui',
        isSensitive: true,
      };
      if (approveReason) body.approveReason = approveReason;

      const res = await fetch('/api/operator/settings/configurations/dex.limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to update dex.limits');
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: operatorKeys.dexLimits() });
      void qc.invalidateQueries({ queryKey: operatorKeys.dexDashboardStats() });
    },
  });
}

/* ─── dex.live ─────────────────────────────────────────────────────────────── */

export function useDexLive(environment?: string, tenantId?: string) {
  return useQuery({
    queryKey: operatorKeys.dexLive(),
    queryFn: async (): Promise<DexLiveConfig> => {
      const params = new URLSearchParams();
      params.append('effective', 'true');
      if (environment) params.append('environment', environment);
      if (tenantId) params.append('tenantId', tenantId);

      const res = await fetch(
        `/api/operator/settings/configurations/dex.live?${params}`,
      );
      if (!res.ok) return DEFAULT_DEX_LIVE;
      const data = await res.json();
      return (data.configValue as DexLiveConfig) ?? DEFAULT_DEX_LIVE;
    },
    staleTime: 30_000,
  });
}

export function useUpdateDexLive() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      config,
      approveReason,
    }: {
      config: DexLiveConfig;
      approveReason?: string;
    }) => {
      const body: Record<string, unknown> = {
        configValue: JSON.stringify(config),
        operatorId: 'operator-ui',
        isSensitive: true,
      };
      if (approveReason) body.approveReason = approveReason;

      const res = await fetch('/api/operator/settings/configurations/dex.live', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to update dex.live');
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: operatorKeys.dexLive() });
      void qc.invalidateQueries({ queryKey: operatorKeys.dexDashboardStats() });
    },
  });
}

/* ─── Kill switch (convenience — sets killSwitch: true on dex.limits) ──────── */

export function useDexKillSwitch() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      currentConfig,
      approveReason,
    }: {
      currentConfig: DexLimitsConfig;
      approveReason: string;
    }) => {
      const updated: DexLimitsConfig = { ...currentConfig, killSwitch: true, enabled: false };
      const body = {
        configValue: JSON.stringify(updated),
        operatorId: 'operator-ui',
        isSensitive: true,
        approveReason,
      };

      const res = await fetch('/api/operator/settings/configurations/dex.limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to activate kill switch');
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: operatorKeys.dexLimits() });
      void qc.invalidateQueries({ queryKey: operatorKeys.dexLive() });
      void qc.invalidateQueries({ queryKey: operatorKeys.dexDashboardStats() });
      void qc.invalidateQueries({ queryKey: operatorKeys.dashboardSummary });
    },
  });
}

/* ─── DEX Operator Actions (speed-up / cancel-tx) ──────────────────────────── */

export function useSpeedUpTx() {
  return useMutation({
    mutationFn: async ({
      planId,
      legId,
      gasMultiplierPct,
      approveReason,
    }: {
      planId: string;
      legId: string;
      gasMultiplierPct: number;
      approveReason: string;
    }) => {
      const res = await fetch(
        `/api/operator/execution/plans/${planId}/legs/${legId}/speed-up`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gasMultiplierPct, approveReason }),
        },
      );
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || 'Failed to speed up transaction');
      }
      return res.json();
    },
  });
}

export function useCancelTx() {
  return useMutation({
    mutationFn: async ({
      planId,
      legId,
      approveReason,
    }: {
      planId: string;
      legId: string;
      approveReason: string;
    }) => {
      const res = await fetch(
        `/api/operator/execution/plans/${planId}/legs/${legId}/cancel-tx`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ approveReason }),
        },
      );
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err || 'Failed to cancel transaction');
      }
      return res.json();
    },
  });
}