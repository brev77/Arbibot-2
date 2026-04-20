'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { fetchOperatorBffJson } from '@/lib/operator-client-api';
import { operatorKeys } from '@/lib/operator-query-keys';
import type { OpenclawSafeModeStatus } from '@/lib/openclaw-types';

/**
 * Shows when OpenClaw safe mode is enabled (polls gateway via BFF).
 */
export function SafeModeBanner(): ReactNode {
  const q = useQuery({
    queryKey: operatorKeys.openclawSafeMode,
    queryFn: () =>
      fetchOperatorBffJson<OpenclawSafeModeStatus>(
        '/openclaw/v1/safe-mode/status',
      ),
    refetchInterval: 20_000,
    retry: false,
  });

  if (q.isError || q.data === undefined) {
    return null;
  }

  if (!q.data.safeMode.enabled) {
    return null;
  }

  return (
    <div
      className="border-b border-rose-500/50 bg-rose-950/40 px-4 py-2 text-center text-sm text-rose-100"
      role="status"
    >
      <strong>Safe mode</strong> is ON (updated {q.data.safeMode.updatedAt}
      {q.data.safeMode.reason !== null ? ` — ${q.data.safeMode.reason}` : ''}).
    </div>
  );
}
