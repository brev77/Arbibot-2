'use client';

import type { ReactNode } from 'react';

import type { ScannerInstanceSummary, ScannerStatusResponse } from '@/lib/scanner-types';

interface ScannerInstancesTableProps {
  readonly instances: ScannerInstanceSummary[];
  readonly status: ScannerStatusResponse | undefined;
  readonly runningInstanceIds: ReadonlySet<string>;
  readonly onRun: (id: string) => void;
  readonly onRefreshConfig: (id: string) => void;
  readonly runningBusyId: string | null;
}

/**
 * Read-only table of configured scanner instances, joined with the worker runtime status
 * (scheduled / running / idle). Operational actions (Run cycle, Refresh config) are inline
 * buttons — these are safe (no capital/execution impact), so no destructive-action modal.
 */
export function ScannerInstancesTable({
  instances,
  status,
  runningInstanceIds,
  onRun,
  onRefreshConfig,
  runningBusyId,
}: ScannerInstancesTableProps): ReactNode {
  if (instances.length === 0) {
    return (
      <p className="text-sm text-slate-400 html.theme-light:text-slate-600">
        No scanner instances configured. Add definitions under{' '}
        <code className="text-xs">scanner.instances</code> in config-service /settings.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-400 html.theme-light:text-slate-600 border-b border-slate-800 html.theme-light:border-slate-200">
            <th className="py-2 pr-4 font-medium">Instance</th>
            <th className="py-2 pr-4 font-medium">Network</th>
            <th className="py-2 pr-4 font-medium">Strategy</th>
            <th className="py-2 pr-4 font-medium">Enabled</th>
            <th className="py-2 pr-4 font-medium">Runtime</th>
            <th className="py-2 pr-4 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {instances.map((inst) => {
            const isRunning = runningInstanceIds.has(inst.id);
            const busy = runningBusyId === inst.id;
            return (
              <tr
                key={inst.id}
                className="border-b border-slate-800/60 html.theme-light:border-slate-200/60"
              >
                <td className="py-2 pr-4">
                  <div className="font-mono text-xs">{inst.id}</div>
                  <div className="text-xs text-slate-400 html.theme-light:text-slate-600">
                    {inst.name}
                  </div>
                </td>
                <td className="py-2 pr-4 font-mono text-xs">{inst.network}</td>
                <td className="py-2 pr-4 font-mono text-xs">{inst.strategy}</td>
                <td className="py-2 pr-4">
                  <RuntimeBadge tone={inst.enabled ? 'ok' : 'muted'}>
                    {inst.enabled ? 'on' : 'off'}
                  </RuntimeBadge>
                </td>
                <td className="py-2 pr-4">
                  {status?.isShuttingDown === true ? (
                    <RuntimeBadge tone="warn">shutting down</RuntimeBadge>
                  ) : isRunning ? (
                    <RuntimeBadge tone="run">running</RuntimeBadge>
                  ) : (
                    <RuntimeBadge tone="muted">idle</RuntimeBadge>
                  )}
                </td>
                <td className="py-2 pr-4">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="operator-nav-link text-xs px-2 py-1 rounded border border-slate-700 html.theme-light:border-slate-300 disabled:opacity-50"
                      onClick={() => onRun(inst.id)}
                      disabled={busy || isRunning || !inst.enabled}
                      title={
                        !inst.enabled
                          ? 'Instance disabled in config'
                          : isRunning
                            ? 'Cycle already running'
                            : 'Trigger one detection cycle'
                      }
                    >
                      {busy ? 'Running…' : 'Run'}
                    </button>
                    <button
                      type="button"
                      className="operator-nav-link text-xs px-2 py-1 rounded border border-slate-700 html.theme-light:border-slate-300 disabled:opacity-50"
                      onClick={() => onRefreshConfig(inst.id)}
                      disabled={busy}
                      title="Force-refresh the config cache (applies /settings changes immediately)"
                    >
                      Refresh config
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RuntimeBadge({
  tone,
  children,
}: {
  tone: 'ok' | 'muted' | 'run' | 'warn';
  children: ReactNode;
}): ReactNode {
  const cls = {
    ok: 'text-emerald-400 html.theme-light:text-emerald-700',
    muted: 'text-slate-400 html.theme-light:text-slate-600',
    run: 'text-sky-400 html.theme-light:text-sky-700',
    warn: 'text-amber-400 html.theme-light:text-amber-700',
  }[tone];
  return <span className={`text-xs font-mono ${cls}`}>{children}</span>;
}
