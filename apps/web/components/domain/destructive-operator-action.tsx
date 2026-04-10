'use client';

import {
  useCallback,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

export type DestructiveOperatorActionProps = {
  /** Shown on the trigger control, e.g. "Force Hedge". */
  actionLabel: string;
  /** Dialog title. */
  title: string;
  /** Human-readable impact lines (preview before confirmation). */
  impactLines: readonly string[];
  /** Typed confirmation; default `CONFIRM`. */
  confirmPhrase?: string;
  /** Called only after impact review + phrase match + final confirm. Wire API + audit here. */
  onConfirmed: () => void | Promise<void>;
};

/**
 * Two-step destructive flow: impact preview, then typed confirmation (operator spec).
 */
export function DestructiveOperatorAction({
  actionLabel,
  title,
  impactLines,
  confirmPhrase = 'CONFIRM',
  onConfirmed,
}: DestructiveOperatorActionProps): ReactNode {
  const dialogId = useId();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setStep(1);
    setPhrase('');
    setError(null);
  }, []);

  const handleConfirmed = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirmed();
      close();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }, [close, onConfirmed]);

  const onSubmitFinal = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (phrase.trim() !== confirmPhrase) {
        setError(`Type "${confirmPhrase}" to proceed.`);
        return;
      }
      void handleConfirmed();
    },
    [confirmPhrase, handleConfirmed, phrase],
  );

  return (
    <>
      <button
        type="button"
        className="destructive-op-trigger"
        style={{
          padding: '0.5rem 1rem',
          borderRadius: 6,
          border: '1px solid #b45309',
          background: '#422006',
          color: '#fdba74',
          cursor: 'pointer',
        }}
        onClick={() => setOpen(true)}
      >
        {actionLabel}
      </button>

      {open ? (
        <dialog
          id={dialogId}
          open
          style={{
            maxWidth: 480,
            border: '1px solid #334155',
            borderRadius: 8,
            padding: '1.25rem',
            background: '#0f172a',
            color: '#e2e8f0',
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>{title}</h2>

          {step === 1 ? (
            <>
              <p style={{ color: '#94a3b8', fontSize: 14 }}>Impact preview</p>
              <ul style={{ margin: '0.75rem 0', paddingLeft: '1.25rem' }}>
                {impactLines.map((line) => (
                  <li key={line} style={{ marginBottom: 6 }}>
                    {line}
                  </li>
                ))}
              </ul>
              <p style={{ color: '#94a3b8', fontSize: 13 }}>
                This action is audited. Continue only if you accept the impact.
              </p>
              <div
                style={{
                  display: 'flex',
                  gap: '0.75rem',
                  justifyContent: 'flex-end',
                  marginTop: '1rem',
                }}
              >
                <button
                  type="button"
                  onClick={close}
                  style={{
                    padding: '0.4rem 0.9rem',
                    borderRadius: 6,
                    border: '1px solid #475569',
                    background: 'transparent',
                    color: '#e2e8f0',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  style={{
                    padding: '0.4rem 0.9rem',
                    borderRadius: 6,
                    border: 'none',
                    background: '#b45309',
                    color: '#fff7ed',
                    cursor: 'pointer',
                  }}
                >
                  Continue to confirm
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={onSubmitFinal}>
              <p style={{ color: '#94a3b8', fontSize: 14 }}>
                Type <strong>{confirmPhrase}</strong> to confirm.
              </p>
              <input
                name="confirm"
                value={phrase}
                onChange={(ev) => setPhrase(ev.target.value)}
                autoComplete="off"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  marginTop: 8,
                  padding: '0.5rem 0.65rem',
                  borderRadius: 6,
                  border: '1px solid #475569',
                  background: '#020617',
                  color: '#e2e8f0',
                }}
              />
              {error ? (
                <p style={{ color: '#fca5a5', fontSize: 13, marginTop: 8 }}>
                  {error}
                </p>
              ) : null}
              <div
                style={{
                  display: 'flex',
                  gap: '0.75rem',
                  justifyContent: 'flex-end',
                  marginTop: '1rem',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setStep(1);
                    setPhrase('');
                    setError(null);
                  }}
                  style={{
                    padding: '0.4rem 0.9rem',
                    borderRadius: 6,
                    border: '1px solid #475569',
                    background: 'transparent',
                    color: '#e2e8f0',
                    cursor: 'pointer',
                  }}
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  style={{
                    padding: '0.4rem 0.9rem',
                    borderRadius: 6,
                    border: 'none',
                    background: busy ? '#57534e' : '#dc2626',
                    color: '#fff',
                    cursor: busy ? 'not-allowed' : 'pointer',
                  }}
                >
                  {busy ? 'Working…' : 'Confirm'}
                </button>
              </div>
            </form>
          )}
        </dialog>
      ) : null}
    </>
  );
}
