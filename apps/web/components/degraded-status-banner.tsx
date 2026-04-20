'use client';

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

type DegradationPayload = {
  tier: 'baseline' | 'hot' | 'warm' | 'cold';
  fallbackMode: boolean;
  throttledRate: number;
  policyCacheTtlMs: number;
  lastPolicyRefreshAtIso: string | null;
  intakeThrottlingEnabled: boolean;
};

const POLL_MS = 30_000;

function tierStyles(tier: DegradationPayload['tier'], fallback: boolean): string {
  if (fallback || tier === 'baseline') {
    return 'border-amber-600/50 bg-amber-950/40 text-amber-100';
  }
  if (tier === 'warm') {
    return 'border-yellow-600/40 bg-yellow-950/30 text-yellow-100';
  }
  if (tier === 'cold') {
    return 'border-orange-700/50 bg-orange-950/40 text-orange-100';
  }
  return 'border-emerald-700/40 bg-emerald-950/25 text-emerald-100';
}

/**
 * Polls market-intake degradation via operator BFF (Phase 4 UI signals).
 */
export function DegradedStatusBanner(): ReactNode {
  const [data, setData] = useState<DegradationPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/operator/health/degradation', {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const json = (await res.json()) as DegradationPayload;
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
        Intake status unavailable: {error}
      </div>
    );
  }

  if (data === null) {
    return null;
  }

  const visible =
    data.fallbackMode ||
    data.tier !== 'hot' ||
    data.throttledRate > 1e-6;

  if (!visible) {
    return null;
  }

  return (
    <div
      className={`mx-4 mb-2 rounded-md border px-3 py-2 text-sm ${tierStyles(data.tier, data.fallbackMode)}`}
      role="status"
      aria-live="polite"
    >
      <strong className="font-semibold">Market intake</strong>
      {': '}
      {data.fallbackMode
        ? 'policy reads degraded — operating in baseline mode. '
        : `tier ${data.tier}. `}
      {data.intakeThrottlingEnabled ? 'Throttling enabled. ' : 'Throttling off. '}
      Throttle events (approx / 5m window rate): {data.throttledRate.toFixed(4)}/s.
      {data.lastPolicyRefreshAtIso !== null ? (
        <>
          {' '}
          Policy cache refreshed {data.lastPolicyRefreshAtIso}.
        </>
      ) : null}
    </div>
  );
}
