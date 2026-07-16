'use client';

import { useState, type ReactNode } from 'react';

import { Button } from './ui/button';

/**
 * Emergency-stop / recover button (D4-C-3-PANIC). Renders a prominent red button
 * in the operator top-bar.
 *
 * Flow:
 *   1. Click "EMERGENCY STOP" → typed-phrase gate → POST /api/operator/system/panic-stop.
 *      The backend flips `dex.limits.killSwitch=true`; response carries a follow-up
 *      CLI instruction for the env-read flags (paper-discovery, risk-policy-jobs).
 *   2. After stop, the button becomes "RESUME TRADING" → requires the typed confirm
 *      phrase → POST /api/operator/system/panic-recover.
 *
 * The button does NOT auto-detect kill-switch state on mount (would need a status
 * endpoint); it tracks local state from the last action. Operators can always run
 * `npm run panic:stop` from a terminal for the complete panic surface.
 */
const STOP_PHRASE = 'PANIC';
const RECOVER_PHRASE = 'I UNDERSTAND THIS RESUMES TRADING';

type Phase = 'idle-stopped' | 'confirm-stop' | 'halted' | 'confirm-recover';

export function PanicButton(): ReactNode {
  const [phase, setPhase] = useState<Phase>('idle-stopped');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState<string | null>(null);

  const reset = (): void => {
    setTyped('');
    setError(null);
  };

  const doStop = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/system/panic-stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: 'operator UI' }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        followUpCli?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setFollowUp(data.followUpCli ?? null);
      setPhase('halted');
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doRecover = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/operator/system/panic-recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ confirm: typed, reason: 'operator UI' }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setFollowUp(null);
      setPhase('idle-stopped');
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Stopped (idle) state: show the big red STOP button.
  if (phase === 'idle-stopped') {
    return (
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => {
          reset();
          setPhase('confirm-stop');
        }}
        disabled={busy}
        aria-label="Emergency stop — halt live trading"
      >
        ⛔ EMERGENCY STOP
      </Button>
    );
  }

  // Confirm-stop modal: typed phrase gate.
  if (phase === 'confirm-stop') {
    return (
      <PanicDialog
        title="Confirm EMERGENCY STOP"
        tone="stop"
        phrase={STOP_PHRASE}
        typed={typed}
        onTyped={setTyped}
        busy={busy}
        error={error}
        onCancel={() => {
          reset();
          setPhase('idle-stopped');
        }}
        onConfirm={() => {
          void doStop();
        }}
        extra={
          <p className="text-xs text-amber-200 html.theme-light:text-amber-800">
            This halts the live capital path (dex.limits.killSwitch). For a full
            stop including paper-discovery and risk-policy-jobs, also run{' '}
            <code className="font-mono">npm run panic:stop</code> from a terminal.
          </p>
        }
      />
    );
  }

  // Halted state: show RESUME button + the follow-up CLI instruction.
  if (phase === 'halted') {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-red-400 html.theme-light:text-red-700">
          HALTED
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            reset();
            setPhase('confirm-recover');
          }}
          disabled={busy}
        >
          Resume trading
        </Button>
        {followUp !== null && (
          <span className="hidden md:inline text-xs text-amber-300 html.theme-light:text-amber-800">
            {followUp}
          </span>
        )}
      </div>
    );
  }

  // Confirm-recover modal: typed long phrase gate.
  return (
    <PanicDialog
      title="Confirm RESUME TRADING"
      tone="recover"
      phrase={RECOVER_PHRASE}
      typed={typed}
      onTyped={setTyped}
      busy={busy}
      error={error}
      onCancel={() => {
        reset();
        setPhase('halted');
      }}
      onConfirm={() => {
        void doRecover();
      }}
      extra={
        <p className="text-xs text-slate-300 html.theme-light:text-slate-700">
          Resuming trading re-enables the live capital path. Type the full phrase
          exactly.
        </p>
      }
    />
  );
}

interface PanicDialogProps {
  readonly title: string;
  readonly tone: 'stop' | 'recover';
  readonly phrase: string;
  readonly typed: string;
  readonly onTyped: (v: string) => void;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly extra?: ReactNode;
}

function PanicDialog({
  title,
  tone,
  phrase,
  typed,
  onTyped,
  busy,
  error,
  onCancel,
  onConfirm,
  extra,
}: PanicDialogProps): ReactNode {
  const matches = typed === phrase;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="max-w-lg rounded-lg border border-red-900/60 bg-slate-950 p-6 shadow-xl html.theme-light:border-red-200 html.theme-light:bg-white">
        <h2 className="text-lg font-semibold text-red-300 html.theme-light:text-red-800">
          {title}
        </h2>
        <p className="mt-2 text-sm text-slate-300 html.theme-light:text-slate-700">
          Type{' '}
          <span className="font-mono font-semibold text-amber-200 html.theme-light:text-amber-900">
            {phrase}
          </span>{' '}
          to confirm.
        </p>
        <input
          type="text"
          value={typed}
          onChange={(e) => onTyped(e.target.value)}
          className="mt-3 flex h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1 font-mono text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 html.theme-light:border-slate-300 html.theme-light:bg-white html.theme-light:text-slate-900"
          autoComplete="off"
          placeholder={phrase}
          autoFocus
        />
        {extra}
        <div className="mt-5 flex justify-end gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={tone === 'stop' ? 'destructive' : 'secondary'}
            onClick={onConfirm}
            disabled={busy || !matches}
          >
            {busy ? 'Processing…' : tone === 'stop' ? 'Stop trading' : 'Resume trading'}
          </Button>
        </div>
        {error !== null && (
          <p className="mt-3 text-sm text-red-300 html.theme-light:text-red-800">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
