'use client';

/**
 * Structured editor for `dex.limits` config key.
 * Shows capital limits, per-chain toggles, gas ceilings, kill switch.
 * Step: DEX-FE-P3.
 */
import { useCallback, useState } from 'react';

import { DestructiveOperatorAction } from '../destructive-operator-action';

import type { DexLimitsConfig, DexChainLimits } from '@/lib/dex-config-types';
import { DEFAULT_DEX_LIMITS } from '@/lib/dex-config-types';
import { getChainMeta } from '@/lib/dex-utils';
import {
  useDexLimits,
  useUpdateDexLimits,
  useDexKillSwitch,
} from '@/lib/use-dex-config';

const KNOWN_CHAIN_IDS = [42161, 8453, 56];

type DexLimitsPanelProps = {
  readonly environment?: string;
  readonly tenantId?: string;
};

export function DexLimitsPanel({ environment, tenantId }: DexLimitsPanelProps) {
  const { data: config, isLoading } = useDexLimits(environment, tenantId);
  const updateMutation = useUpdateDexLimits();
  const killSwitchMutation = useDexKillSwitch();

  const [draft, setDraft] = useState<DexLimitsConfig | null>(null);
  const [approveReason, setApproveReason] = useState('');
  const [killSwitchReason, setKillSwitchReason] = useState('');
  const [killSwitchOpen, setKillSwitchOpen] = useState(false);

  const current: DexLimitsConfig = draft ?? config ?? DEFAULT_DEX_LIMITS;
  const hasChanges = draft !== null && JSON.stringify(draft) !== JSON.stringify(config ?? DEFAULT_DEX_LIMITS);

  const updateField = useCallback(<K extends keyof DexLimitsConfig>(key: K, value: DexLimitsConfig[K]) => {
    setDraft((prev) => {
      const base = prev ?? config ?? DEFAULT_DEX_LIMITS;
      return { ...base, [key]: value };
    });
  }, [config]);

  const updateChainField = useCallback(
    (chainId: string, field: keyof DexChainLimits, value: number | boolean) => {
      setDraft((prev) => {
        const base = prev ?? config ?? DEFAULT_DEX_LIMITS;
        const chains = { ...base.chains };
        const existing = chains[chainId] ?? {
          enabled: false,
          maxGasPriceGwei: 30,
          maxPriorityFeeGwei: 1,
          maxGasPerTradeGwei: 5000000,
          maxNotionalPerTradeUsd: 500,
        };
        chains[chainId] = { ...existing, [field]: value };
        return { ...base, chains };
      });
    },
    [config],
  );

  const submitUpdate = useCallback(() => {
    if (draft === null) return;
    updateMutation.mutate(
      { config: draft, approveReason: approveReason || undefined },
      { onSettled: () => { setDraft(null); setApproveReason(''); } },
    );
  }, [draft, approveReason, updateMutation]);

  const submitKillSwitch = useCallback(() => {
    const base = config ?? DEFAULT_DEX_LIMITS;
    killSwitchMutation.mutate(
      { currentConfig: base, approveReason: killSwitchReason },
      { onSettled: () => { setKillSwitchOpen(false); setKillSwitchReason(''); } },
    );
  }, [config, killSwitchReason, killSwitchMutation]);

  if (isLoading) {
    return <div className="text-sm text-slate-500">Loading DEX limits…</div>;
  }

  return (
    <div className="space-y-6">
      {/* Kill switch banner */}
      {current.killSwitch && (
        <div className="p-3 bg-red-950 border border-red-700 rounded text-sm text-red-300">
          ⚠️ <strong>Kill switch is ACTIVE</strong> — all DEX trading is halted. Deactivate via config to resume.
        </div>
      )}

      {/* Global toggles */}
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Global limits</h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={current.enabled}
            onChange={(e) => updateField('enabled', e.target.checked)}
          />
          DEX trading enabled
        </label>
        <NumberField
          label="Max notional per trade (USD)"
          value={current.maxNotionalPerTradeUsd}
          onChange={(v) => updateField('maxNotionalPerTradeUsd', v)}
        />
        <NumberField
          label="Max daily notional (USD)"
          value={current.maxDailyNotionalUsd}
          onChange={(v) => updateField('maxDailyNotionalUsd', v)}
        />
        <NumberField
          label="Max open positions"
          value={current.maxOpenPositions}
          onChange={(v) => updateField('maxOpenPositions', v)}
        />
        <NumberField
          label="Max slippage (bps)"
          value={current.maxSlippageBps}
          onChange={(v) => updateField('maxSlippageBps', v)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={current.requireTwoPersonApproval}
            onChange={(e) => updateField('requireTwoPersonApproval', e.target.checked)}
          />
          Require two-person approval
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={current.requireOperatorApprovalPerTrade}
            onChange={(e) => updateField('requireOperatorApprovalPerTrade', e.target.checked)}
          />
          Require operator approval per trade
        </label>
      </div>

      {/* Per-chain limits */}
      <div className="space-y-4">
        <h3 className="text-base font-semibold">Per-chain limits</h3>
        {KNOWN_CHAIN_IDS.map((chainId) => {
          const chainMeta = getChainMeta(chainId);
          const chainKey = String(chainId);
          const chainCfg = current.chains[chainKey];
          return (
            <div
              key={chainId}
              className="border border-slate-700 rounded-lg p-4 space-y-3 html.theme-light:border-slate-200"
            >
              <div className="flex items-center gap-2">
                {chainMeta !== null && (
                  <span
                    className="inline-block w-3 h-3 rounded-full"
                    style={{ background: chainMeta.color }}
                  />
                )}
                <span className="font-medium text-sm">
                  {chainMeta?.shortName ?? `Chain ${chainId}`}
                </span>
                <span className="text-xs text-slate-500">({chainId})</span>
                {chainCfg !== undefined && (
                  <label className="ml-auto flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={chainCfg.enabled}
                      onChange={(e) => updateChainField(chainKey, 'enabled', e.target.checked)}
                    />
                    Enabled
                  </label>
                )}
              </div>
              {chainCfg !== undefined ? (
                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label="Max gas price (Gwei)"
                    value={chainCfg.maxGasPriceGwei}
                    onChange={(v) => updateChainField(chainKey, 'maxGasPriceGwei', v)}
                  />
                  <NumberField
                    label="Max priority fee (Gwei)"
                    value={chainCfg.maxPriorityFeeGwei}
                    onChange={(v) => updateChainField(chainKey, 'maxPriorityFeeGwei', v)}
                  />
                  <NumberField
                    label="Max gas per trade (Gwei)"
                    value={chainCfg.maxGasPerTradeGwei}
                    onChange={(v) => updateChainField(chainKey, 'maxGasPerTradeGwei', v)}
                  />
                  <NumberField
                    label="Max notional per trade (USD)"
                    value={chainCfg.maxNotionalPerTradeUsd}
                    onChange={(v) => updateChainField(chainKey, 'maxNotionalPerTradeUsd', v)}
                  />
                </div>
              ) : (
                <p className="text-xs text-slate-500">
                  No limits configured for this chain. Add via JSON editor.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Save button */}
      {hasChanges && (
        <div className="flex items-end gap-3 pt-2">
          <label className="block text-sm flex-1">
            Approval reason (required for dex.limits)
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
              value={approveReason}
              onChange={(e) => setApproveReason(e.target.value)}
              placeholder="Reason for config change"
            />
          </label>
          <DestructiveOperatorAction
            actionLabel="Save dex.limits"
            level="high"
            requireTypedConfirmPhrase="APPROVE"
            impactPreview={{
              affectedResources: 'dex.limits',
              potentialConsequences:
                'Updates DEX capital/risk limits. Services will pick up changes after cache TTL.',
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

      {/* Kill switch */}
      <div className="border-t border-slate-700 pt-4 html.theme-light:border-slate-200">
        <h3 className="text-base font-semibold text-red-400">Emergency: Kill switch</h3>
        <p className="text-xs text-slate-500 mb-3">
          Immediately halts ALL DEX trading. Sets <code>killSwitch: true</code> and{' '}
          <code>enabled: false</code> on dex.limits.
        </p>
        {!current.killSwitch ? (
          <button
            type="button"
            className="px-3 py-1.5 text-sm rounded bg-red-900 text-red-200 hover:bg-red-800 disabled:opacity-50"
            onClick={() => setKillSwitchOpen(true)}
            disabled={killSwitchMutation.isPending}
          >
            {killSwitchMutation.isPending ? 'Activating…' : 'Activate Kill Switch'}
          </button>
        ) : (
          <p className="text-sm text-red-400 font-medium">
            Kill switch is active. Use config editor to deactivate.
          </p>
        )}
      </div>

      {/* Kill switch confirmation dialog */}
      {killSwitchOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="max-w-md w-full rounded-lg border border-red-800 bg-slate-950 p-6 shadow-xl html.theme-light:bg-white html.theme-light:border-red-300">
            <h3 className="text-lg font-semibold text-red-400">⚠️ Kill Switch</h3>
            <p className="mt-2 text-sm text-slate-300 html.theme-light:text-slate-700">
              This will <strong>immediately halt all DEX trading</strong>. All pending transactions
              will be left to complete or time out. No new DEX trades will be submitted.
            </p>
            <label className="block mt-4 text-sm text-slate-300 html.theme-light:text-slate-700">
              Approval reason (required)
              <input
                className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
                value={killSwitchReason}
                onChange={(e) => setKillSwitchReason(e.target.value)}
                placeholder="Emergency reason"
              />
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="px-3 py-1.5 text-sm rounded border border-slate-700 text-slate-400"
                onClick={() => { setKillSwitchOpen(false); setKillSwitchReason(''); }}
              >
                Cancel
              </button>
              <DestructiveOperatorAction
                actionLabel="CONFIRM KILL SWITCH"
                level="high"
                requireTypedConfirmPhrase="KILL SWITCH"
                impactPreview={{
                  affectedResources: 'All DEX trading on all chains',
                  potentialConsequences:
                    'Immediately disables all DEX execution. Pending transactions are not cancelled but no new ones will be submitted.',
                }}
                onConfirm={submitKillSwitch}
                disabled={killSwitchReason.trim().length === 0 || killSwitchMutation.isPending}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Helper: number input field ───────────────────────────────────────────── */

function NumberField({
  label,
  value,
  onChange,
  min = 0,
}: {
  readonly label: string;
  readonly value: number;
  readonly onChange: (v: number) => void;
  readonly min?: number;
}) {
  return (
    <label className="block text-sm">
      <span className="text-slate-400 html.theme-light:text-slate-600">{label}</span>
      <input
        type="number"
        min={min}
        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}