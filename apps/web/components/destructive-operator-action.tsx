'use client';

import { useState, type ReactNode } from 'react';

import { Button } from './ui/button';

type OperationStatus = 'idle' | 'pending' | 'running' | 'success' | 'failure';

type ActionLevel = 'low' | 'medium' | 'high';

interface ImpactPreview {
  readonly affectedResources: string;
  readonly potentialConsequences: string;
  readonly mitigation?: string;
}

interface DestructiveOperatorActionProps {
  readonly level: ActionLevel;
  readonly actionLabel: string;
  readonly impactPreview?: ImpactPreview;
  /** When set with `level="high"`, step 2 requires this exact phrase before execute. */
  readonly requireTypedConfirmPhrase?: string;
  /** May return any Promise (e.g. React Query mutateAsync); result is ignored. */
  readonly onConfirm: () => void | Promise<unknown>;
  readonly disabled: boolean;
}

export function DestructiveOperatorAction({
  level,
  actionLabel,
  impactPreview,
  requireTypedConfirmPhrase,
  onConfirm,
  disabled,
}: DestructiveOperatorActionProps): ReactNode {
  const [status, setStatus] = useState<OperationStatus>('idle');
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [highRiskStep, setHighRiskStep] = useState<1 | 2>(1);
  const [typedPhrase, setTypedPhrase] = useState('');

  const isHighRisk = level === 'high';
  const isMediumRisk = level === 'medium';
  const needsTypedSecondStep =
    isHighRisk &&
    requireTypedConfirmPhrase !== undefined &&
    requireTypedConfirmPhrase.length > 0;

  const handleClick = () => {
    if (isHighRisk || isMediumRisk) {
      setHighRiskStep(1);
      setTypedPhrase('');
      setShowConfirmation(true);
    } else {
      void executeAction();
    }
  };

  const executeAction = async () => {
    setStatus('running');
    try {
      await onConfirm();
      setStatus('success');
      setShowConfirmation(false);
      setHighRiskStep(1);
      setTypedPhrase('');
    } catch (error) {
      setStatus('failure');
      console.error('Operation failed:', error);
    }
  };

  const handleCancel = () => {
    setShowConfirmation(false);
    setStatus('idle');
    setHighRiskStep(1);
    setTypedPhrase('');
  };

  const getButtonText = (): string => {
    if (status === 'running') {
      return 'Processing…';
    }
    if (status === 'success') {
      return 'Completed';
    }
    if (status === 'failure') {
      return 'Failed';
    }
    return actionLabel;
  };

  const getButtonVariant = () => {
    if (status === 'success') {
      return 'ghost' as const;
    }
    if (status === 'failure') {
      return 'destructive' as const;
    }
    return 'secondary' as const;
  };

  return (
    <>
      <Button
        type="button"
        variant={getButtonVariant()}
        size="sm"
        onClick={handleClick}
        disabled={disabled || status === 'running'}
      >
        {getButtonText()}
      </Button>

      {showConfirmation && isHighRisk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="max-w-lg rounded-lg border border-slate-800 bg-slate-950 p-6 shadow-xl html.theme-light:border-slate-200 html.theme-light:bg-white">
            <h2 className="text-lg font-semibold text-slate-100 html.theme-light:text-slate-900">
              Confirm destructive action
            </h2>
            <p className="mt-2 text-sm text-slate-400 html.theme-light:text-slate-600">
              You are about to perform a high-risk operation. Please review the impact
              preview before confirming.
            </p>

            {highRiskStep === 1 && (
              <>
                {impactPreview ? (
                  <div className="mt-4 rounded-md border border-amber-900/40 bg-amber-950/20 p-4 html.theme-light:border-amber-200 html.theme-light:bg-amber-50">
                    <h3 className="text-sm font-medium text-amber-200 html.theme-light:text-amber-900">
                      Impact preview
                    </h3>
                    <dl className="mt-2 space-y-2 text-sm">
                      <div>
                        <dt className="text-slate-400 html.theme-light:text-slate-600">
                          Affected resources:
                        </dt>
                        <dd className="text-slate-100 html.theme-light:text-slate-900">
                          {impactPreview.affectedResources}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-slate-400 html.theme-light:text-slate-600">
                          Potential consequences:
                        </dt>
                        <dd className="text-slate-100 html.theme-light:text-slate-900">
                          {impactPreview.potentialConsequences}
                        </dd>
                      </div>
                      {impactPreview.mitigation && (
                        <div>
                          <dt className="text-slate-400 html.theme-light:text-slate-600">
                            Mitigation:
                          </dt>
                          <dd className="text-slate-100 html.theme-light:text-slate-900">
                            {impactPreview.mitigation}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-400 html.theme-light:text-slate-600">
                    Please confirm this high-risk operation.
                  </p>
                )}
              </>
            )}

            {highRiskStep === 2 && needsTypedSecondStep && (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-slate-300 html.theme-light:text-slate-700">
                  Type{' '}
                  <span className="font-mono font-semibold text-amber-200 html.theme-light:text-amber-900">
                    {requireTypedConfirmPhrase}
                  </span>{' '}
                  to confirm.
                </p>
                <input
                  type="text"
                  value={typedPhrase}
                  onChange={(e) => setTypedPhrase(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-1 text-sm font-mono text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 html.theme-light:border-slate-300 html.theme-light:bg-white html.theme-light:text-slate-900"
                  autoComplete="off"
                  placeholder={requireTypedConfirmPhrase}
                />
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={handleCancel}
                disabled={status === 'running'}
              >
                Cancel
              </Button>
              {needsTypedSecondStep && highRiskStep === 1 && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setHighRiskStep(2)}
                  disabled={status === 'running'}
                >
                  Continue to confirmation
                </Button>
              )}
              {(!needsTypedSecondStep || highRiskStep === 2) && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    void executeAction();
                  }}
                  disabled={
                    status === 'running' ||
                    (needsTypedSecondStep &&
                      typedPhrase !== requireTypedConfirmPhrase)
                  }
                >
                  {status === 'running' ? 'Processing…' : 'Confirm and execute'}
                </Button>
              )}
            </div>

            {status === 'failure' && (
              <p className="mt-4 text-sm text-red-300 html.theme-light:text-red-900">
                Operation failed. Please try again or contact support if the issue persists.
              </p>
            )}
          </div>
        </div>
      )}

      {showConfirmation && isMediumRisk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="max-w-md rounded-lg border border-slate-800 bg-slate-950 p-6 shadow-xl html.theme-light:border-slate-200 html.theme-light:bg-white">
            <h2 className="text-lg font-semibold text-slate-100 html.theme-light:text-slate-900">
              Confirm action
            </h2>
            <p className="mt-2 text-sm text-slate-400 html.theme-light:text-slate-600">
              Are you sure you want to proceed with this action?
            </p>

            {impactPreview && (
              <div className="mt-4 rounded-md border border-slate-700 bg-slate-900/50 p-4 html.theme-light:border-slate-200 html.theme-light:bg-slate-100">
                <h3 className="text-sm font-medium text-slate-100 html.theme-light:text-slate-900">
                  Impact preview
                </h3>
                <dl className="mt-2 space-y-2 text-sm">
                  <div>
                    <dt className="text-slate-400 html.theme-light:text-slate-600">
                      Affected resources:
                    </dt>
                    <dd className="text-slate-100 html.theme-light:text-slate-900">
                      {impactPreview.affectedResources}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400 html.theme-light:text-slate-600">
                      Potential consequences:
                    </dt>
                    <dd className="text-slate-100 html.theme-light:text-slate-900">
                      {impactPreview.potentialConsequences}
                    </dd>
                  </div>
                </dl>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={handleCancel}
                disabled={status === 'running'}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  void executeAction();
                }}
                disabled={status === 'running'}
              >
                {status === 'running' ? 'Processing…' : 'Confirm'}
              </Button>
            </div>

            {status === 'failure' && (
              <p className="mt-4 text-sm text-red-300 html.theme-light:text-red-900">
                Operation failed. Please try again.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
