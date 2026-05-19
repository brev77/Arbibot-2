'use client';

/**
 * DEX operator actions for execution plan detail.
 * Speed-up and cancel-tx with two-step approval + audit.
 * Step: DEX-FE-P3.
 */
import { useCallback, useState } from 'react';

import { DestructiveOperatorAction } from './destructive-operator-action';

import type { ExecutionLegItem } from '@/lib/execution-types';
import { useSpeedUpTx, useCancelTx } from '@/lib/use-dex-config';

type DexOperatorActionsProps = {
  readonly planId: string;
  readonly legs: ExecutionLegItem[];
  readonly isDex: boolean;
};

export function DexOperatorActions({ planId, legs, isDex }: DexOperatorActionsProps) {
  const speedUpMutation = useSpeedUpTx();
  const cancelMutation = useCancelTx();

  const [selectedLegId, setSelectedLegId] = useState<string>('');
  const [gasMultiplier, setGasMultiplier] = useState(150);
  const [approveReason, setApproveReason] = useState('');

  const handleSpeedUp = useCallback(() => {
    if (!selectedLegId || !approveReason.trim()) return;
    speedUpMutation.mutate(
      {
        planId,
        legId: selectedLegId,
        gasMultiplierPct: gasMultiplier,
        approveReason: approveReason.trim(),
      },
      { onSettled: () => { setApproveReason(''); } },
    );
  }, [planId, selectedLegId, gasMultiplier, approveReason, speedUpMutation]);

  const handleCancel = useCallback(() => {
    if (!selectedLegId || !approveReason.trim()) return;
    cancelMutation.mutate(
      {
        planId,
        legId: selectedLegId,
        approveReason: approveReason.trim(),
      },
      { onSettled: () => { setApproveReason(''); } },
    );
  }, [planId, selectedLegId, approveReason, cancelMutation]);

  if (!isDex) return null;

  const actionableLegs = legs.filter(
    (l) => l.state === 'sent' || l.state === 'acknowledged' || l.state === 'created',
  );

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">DEX operator actions</h3>
      <p className="text-xs text-slate-500">
        Speed-up re-submits a pending tx with higher gas. Cancel sends a zero-value replacement tx
        with the same nonce + higher gas. Both require operator approval and produce an audit trail.
      </p>

      {actionableLegs.length === 0 ? (
        <p className="text-sm text-slate-500">
          No actionable legs (sent/acknowledged/created) available for operator actions.
        </p>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="text-slate-400">Select leg</span>
            <select
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
              value={selectedLegId}
              onChange={(e) => setSelectedLegId(e.target.value)}
            >
              <option value="">— select leg —</option>
              {actionableLegs.map((leg) => (
                <option key={leg.id} value={leg.id}>
                  Leg #{leg.legIndex} — {leg.state} — {leg.venueRef ?? 'no venue ref'}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="text-slate-400">Approval reason (required)</span>
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
              value={approveReason}
              onChange={(e) => setApproveReason(e.target.value)}
              placeholder="Reason for operator action"
            />
          </label>

          {selectedLegId && (
            <div className="flex flex-wrap gap-3 pt-2">
              {/* Speed-up */}
              <div className="space-y-2">
                <label className="block text-sm">
                  <span className="text-slate-400">Gas multiplier (%)</span>
                  <input
                    type="number"
                    min={100}
                    max={500}
                    className="mt-1 w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
                    value={gasMultiplier}
                    onChange={(e) => setGasMultiplier(Number(e.target.value))}
                  />
                </label>
                <DestructiveOperatorAction
                  actionLabel="Speed Up Transaction"
                  level="high"
                  requireTypedConfirmPhrase="SPEED UP"
                  impactPreview={{
                    affectedResources: `Plan ${planId}, Leg ${selectedLegId}`,
                    potentialConsequences:
                      `Re-submits the pending on-chain transaction with ${gasMultiplier}% gas. The original tx may still confirm — resulting in TWO transactions.`,
                  }}
                  onConfirm={handleSpeedUp}
                  disabled={
                    approveReason.trim().length === 0 ||
                    gasMultiplier < 101 ||
                    speedUpMutation.isPending
                  }
                />
              </div>

              {/* Cancel */}
              <div className="space-y-2">
                <DestructiveOperatorAction
                  actionLabel="Cancel Transaction"
                  level="high"
                  requireTypedConfirmPhrase="CANCEL TX"
                  impactPreview={{
                    affectedResources: `Plan ${planId}, Leg ${selectedLegId}`,
                    potentialConsequences:
                      'Sends a zero-value replacement tx with same nonce + higher gas. The original tx may still confirm before the cancellation tx.',
                  }}
                  onConfirm={handleCancel}
                  disabled={
                    approveReason.trim().length === 0 ||
                    cancelMutation.isPending
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mutation status */}
      {(speedUpMutation.isError || cancelMutation.isError) && (
        <div className="p-3 bg-red-950 border border-red-700 rounded text-sm text-red-300">
          {speedUpMutation.isError
            ? `Speed-up error: ${String(speedUpMutation.error)}`
            : ''}
          {cancelMutation.isError
            ? `Cancel error: ${String(cancelMutation.error)}`
            : ''}
        </div>
      )}
      {(speedUpMutation.isSuccess || cancelMutation.isSuccess) && (
        <div className="p-3 bg-green-950 border border-green-700 rounded text-sm text-green-300">
          {speedUpMutation.isSuccess ? 'Speed-up submitted successfully.' : ''}
          {cancelMutation.isSuccess ? 'Cancel submitted successfully.' : ''}
        </div>
      )}
    </div>
  );
}