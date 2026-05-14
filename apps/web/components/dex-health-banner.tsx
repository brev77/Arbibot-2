'use client';

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

type ComponentHealth = {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'not_configured';
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
};

type DexHealthPayload = {
  status: 'healthy' | 'degraded' | 'unhealthy';
  rpc: Record<string, ComponentHealth>;
  vault: ComponentHealth;
  wallet: ComponentHealth;
  mempoolMonitor: ComponentHealth;
  timestamp: string;
};

const POLL_MS = 30_000;

function statusStyles(status: DexHealthPayload['status']): string {
  if (status === 'unhealthy') {
    return 'border-red-700/60 bg-red-950/40 text-red-100';
  }
  if (status === 'degraded') {
    return 'border-amber-600/50 bg-amber-950/40 text-amber-100';
  }
  return 'border-emerald-700/40 bg-emerald-950/25 text-emerald-100';
}

function statusLabel(status: string): string {
  switch (status) {
    case 'unhealthy':
      return '🔴 Unhealthy';
    case 'degraded':
      return '🟡 Degraded';
    case 'healthy':
      return '🟢 Healthy';
    default:
      return '⚪ N/A';
  }
}

/**
 * Polls DEX infrastructure health via operator BFF (DEX-1-2-HEALTH).
 * Shows a banner when DEX infrastructure is degraded or unhealthy.
 */
export function DexHealthBanner(): ReactNode {
  const [data, setData] = useState<DexHealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/operator/health/dex', {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const json = (await res.json()) as DexHealthPayload;
      setError(null);
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch failed');
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => void load(), POLL_MS);
    queueMicrotask(() => void load());
    return () => window.clearInterval(id);
  }, [load]);

  if (error !== null && data === null) {
    return (
      <div
        className="mx-4 mb-2 rounded-md border border-red-800/60 bg-red-950/40 px-3 py-2 text-sm text-red-100"
        role="status"
        aria-live="polite"
      >
        DEX health unavailable: {error}
      </div>
    );
  }

  if (data === null) {
    return null;
  }

  // Only show banner when not healthy
  if (data.status === 'healthy') {
    return null;
  }

  // Collect issues for summary
  const issues: string[] = [];
  for (const [chain, rpc] of Object.entries(data.rpc)) {
    if (rpc.status === 'unhealthy' || rpc.status === 'degraded') {
      issues.push(`RPC ${chain}: ${rpc.error ?? rpc.status}`);
    }
  }
  if (data.vault.status !== 'healthy' && data.vault.status !== 'not_configured') {
    issues.push(`Vault: ${data.vault.error ?? data.vault.status}`);
  }
  if (data.wallet.status !== 'healthy' && data.wallet.status !== 'not_configured') {
    issues.push(`Wallet: ${data.wallet.error ?? data.wallet.status}`);
  }

  return (
    <div
      className={`mx-4 mb-2 rounded-md border px-3 py-2 text-sm ${statusStyles(data.status)}`}
      role="status"
      aria-live="polite"
    >
      <strong className="font-semibold">DEX Infrastructure</strong>
      {': '}
      {statusLabel(data.status)}
      {issues.length > 0 && (
        <span className="ml-2 text-xs opacity-80">
          — {issues.join(' | ')}
        </span>
      )}
    </div>
  );
}