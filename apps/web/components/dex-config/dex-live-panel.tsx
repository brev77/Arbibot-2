'use client';

/**
 * Structured editor for `dex.live` config key.
 * Shows live trading toggle, dry-run mode, auto-hedge/unwind, chain selection.
 * Step: DEX-FE-P3.
 */
import { useCallback, useState } from 'react';

import { DestructiveOperatorAction } from '../destructive-operator-action';

import type { DexLiveConfig } from '@/lib/dex-config-types';
import { DEFAULT_DEX_LIVE } from '@/lib/dex-config-types';
import { getChainMeta } from '@/lib/dex-utils';
import { useDexLive, useUpdateDexLive } from '@/lib/use-dex-config';

const ALL_CHAINS = [42161, 8453, 56];

type DexLivePanelProps = {
  readonly environment?: string;
  readonly tenantId?: string;
};

export function DexLivePanel({ environment, tenantId }: DexLivePanelProps) {
  const { data: config, isLoading } = useDexLive(environment, tenantId);
  const updateMutation = useUpdateDexLive();

  const [draft, setDraft] = useState<DexLiveConfig | null>(null);
  const [approveReason, setApproveReason] = useState('');

  const current: DexLiveConfig = draft ?? config ?? DEFAULT_DEX_LIVE;
  const hasChanges = draft !== null && JSON.stringify(draft) !== JSON.stringify(config ?? DEFAULT_DEX_LIVE);

  const updateField = useCallback(<K extends keyof DexLiveConfig>(key: K, value: DexLiveConfig[K]) => {
    setDraft((prev) => {
      const base = prev ?? config ?? DEFAULT_DEX_LIVE;
      return { ...base, [key]: value };
    });
  }, [config]);

  const toggleChain = useCallback((chainId: number) => {
    setDraft((prev) => {
      const base = prev ?? config ?? DEFAULT_DEX_LIVE;
      const key = String(chainId);
      const chains = base.chains.includes(key)
        ? base.chains.filter((c) => c !== key)
        : [...base.chains, key];
      return { ...base, chains };
    });
  }, [config]);

  const submitUpdate = useCallback(() => {
    if (draft === null) return;
    updateMutation.mutate(
      { config: draft, approveReason: approveReason || undefined },
      { onSettled: () => { setDraft(null); setApproveReason(''); } },
    );
  }, [draft, approveReason, updateMutation]);

  if (isLoading) {
    return <div className="text-sm text-slate-500">Loading DEX live config…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Live trading banner */}
      {current.liveEnabled && (
        <div className="p-3 bg-green-950 border border-green-700 rounded text-sm text-green-300">
          ✅ <strong>Live trading is ENABLED</strong> — real on-chain transactions will be submitted.
        </div>
      )}
      {!current.liveEnabled && (
        <div className="p-3 bg-amber-950 border border-amber-700 rounded text-sm text-amber-300">
          🔬 <strong>Paper/dry-run mode</strong> — no real transactions will be submitted.
        </div>
      )}

      {/* Core toggles */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Trading mode</h3>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={current.liveEnabled}
              onChange={(e) => updateField('liveEnabled', e.target.checked)}
            />
            <span className={current.liveEnabled ? 'text-green-400 font-semibold' : ''}>
              Live trading enabled
            </span>
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={current.dryRunMode}
            onChange={(e) => updateField('dryRunMode', e.target.checked)}
          />
          Dry-run mode (simulate without submitting)
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={current.paperParallelEnabled}
            onChange={(e) => updateField('paperParallelEnabled', e.target.checked)}
          />
          Paper parallel mode (run paper alongside live)
        </label>
      </div>

      {/* Chain selection */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Active chains</h3>
        <div className="flex flex-wrap gap-3">
          {ALL_CHAINS.map((chainId) => {
            const meta = getChainMeta(chainId);
            const isActive = current.chains.includes(String(chainId));
            return (
              <label
                key={chainId}
                className="flex items-center gap-2 px-3 py-2 rounded border border-slate-700 text-sm cursor-pointer html.theme-light:border-slate-200"
                style={isActive && meta !== null ? { borderColor: meta.color } : undefined}
              >
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={() => toggleChain(chainId)}
                />
                {meta !== null && (
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ background: meta.color }}
                  />
                )}
                {meta?.shortName ?? `Chain ${chainId}`}
              </label>
            );
          })}
        </div>
      </div>

      {/* Automation */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Automation</h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={current.autoHedgeEnabled}
            onChange={(e) => updateField('autoHedgeEnabled', e.target.checked)}
          />
          Auto-hedge enabled
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={current.autoUnwindEnabled}
            onChange={(e) => updateField('autoUnwindEnabled', e.target.checked)}
          />
          Auto-unwind enabled
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={current.auditAllTrades}
            onChange={(e) => updateField('auditAllTrades', e.target.checked)}
          />
          Audit all trades
        </label>

        <label className="block text-sm">
          <span className="text-slate-400 html.theme-light:text-slate-600">
            Max position duration (minutes)
          </span>
          <input
            type="number"
            min={1}
            className="mt-1 w-40 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
            value={current.maxPositionDurationMinutes}
            onChange={(e) => updateField('maxPositionDurationMinutes', Number(e.target.value))}
          />
        </label>
      </div>

      {/* Save button */}
      {hasChanges && (
        <div className="flex items-end gap-3 pt-2">
          <label className="block text-sm flex-1">
            Approval reason (required for dex.live)
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
              value={approveReason}
              onChange={(e) => setApproveReason(e.target.value)}
              placeholder="Reason for config change"
            />
          </label>
          <DestructiveOperatorAction
            actionLabel="Save dex.live"
            level="high"
            requireTypedConfirmPhrase="APPROVE"
            impactPreview={{
              affectedResources: 'dex.live',
              potentialConsequences: current.liveEnabled
                ? 'Enables LIVE on-chain trading with real capital. Ensure dex.limits are configured.'
                : 'Updates DEX live configuration. Services will pick up changes after cache TTL.',
            }}
            onConfirm={submitUpdate}
            disabled={updateMutation.isPending}
          />
          <button
            type="button"
            className="px-3 py-1.5 text-sm rounded border border-slate-700 text-slate-400 hover:text-slate-200"
            onClick={() => { setDraft(null); setApproveReason(''); }}
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}