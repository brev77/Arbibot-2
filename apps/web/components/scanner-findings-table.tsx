'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import type { ScannerFinding, ScannerPublishStatus } from '@/lib/scanner-types';

interface ScannerFindingsTableProps {
  readonly findings: ScannerFinding[];
  readonly onRepublish: (id: string) => void;
  readonly republishBusyId: string | null;
}

/**
 * Read-only table of scanner findings (cross-venue deals detected by scanner-service). Each
 * row links to the published opportunity (when `opportunityId` is present) and offers a manual
 * re-publish for findings stuck in `pending`/`failed` (operator fallback for the orphan worker).
 */
export function ScannerFindingsTable({
  findings,
  onRepublish,
  republishBusyId,
}: ScannerFindingsTableProps): ReactNode {
  if (findings.length === 0) {
    return (
      <p className="text-sm text-slate-400 html.theme-light:text-slate-600">
        No findings yet. Scanned spreads that pass the instance filters will appear here.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-400 html.theme-light:text-slate-600 border-b border-slate-800 html.theme-light:border-slate-200">
            <th className="py-2 pr-4 font-medium">Observed</th>
            <th className="py-2 pr-4 font-medium">Token</th>
            <th className="py-2 pr-4 font-medium">Venues</th>
            <th className="py-2 pr-4 font-medium text-right">Spread</th>
            <th className="py-2 pr-4 font-medium text-right">Net $</th>
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Opportunity</th>
            <th className="py-2 pr-4 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => {
            const busy = republishBusyId === f.id;
            const canRepublish =
              f.publishStatus === 'pending' || f.publishStatus === 'failed';
            return (
              <tr
                key={f.id}
                className="border-b border-slate-800/60 html.theme-light:border-slate-200/60"
              >
                <td className="py-2 pr-4 text-xs text-slate-400 html.theme-light:text-slate-600 whitespace-nowrap">
                  {new Date(f.observedAt).toLocaleString()}
                </td>
                <td className="py-2 pr-4 font-mono text-xs">
                  <div>{f.canonicalToken}</div>
                  <div className="text-slate-400 html.theme-light:text-slate-600">
                    chain {f.chainId}
                  </div>
                </td>
                <td className="py-2 pr-4 text-xs">
                  <div>buy: {f.buyVenue}</div>
                  <div className="text-slate-400 html.theme-light:text-slate-600">
                    sell: {f.sellVenue}
                  </div>
                </td>
                <td className="py-2 pr-4 text-right font-mono">{f.spreadBps} bps</td>
                <td className="py-2 pr-4 text-right font-mono">
                  {Number(f.netProfitUsd).toFixed(2)}
                </td>
                <td className="py-2 pr-4">
                  <PublishStatusBadge status={f.publishStatus} attempts={f.publishAttempts} />
                </td>
                <td className="py-2 pr-4">
                  {f.opportunityId !== null ? (
                    <Link
                      href={`/opportunities/${f.opportunityId}`}
                      className="operator-nav-link text-xs font-mono underline"
                    >
                      {f.opportunityId.slice(0, 8)}…
                    </Link>
                  ) : (
                    <span className="text-xs text-slate-500 html.theme-light:text-slate-400">
                      —
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  <button
                    type="button"
                    className="operator-nav-link text-xs px-2 py-1 rounded border border-slate-700 html.theme-light:border-slate-300 disabled:opacity-50"
                    onClick={() => onRepublish(f.id)}
                    disabled={!canRepublish || busy}
                    title={
                      canRepublish
                        ? 'Manually re-publish to opportunity-service'
                        : 'Already published'
                    }
                  >
                    {busy ? 'Publishing…' : 'Re-publish'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PublishStatusBadge({
  status,
  attempts,
}: {
  status: ScannerPublishStatus;
  attempts: number;
}): ReactNode {
  const tone =
    status === 'published'
      ? 'text-emerald-400 html.theme-light:text-emerald-700'
      : status === 'failed'
        ? 'text-rose-400 html.theme-light:text-rose-700'
        : 'text-amber-400 html.theme-light:text-amber-700';
  return (
    <span className={`text-xs font-mono ${tone}`}>
      {status}
      {attempts > 0 ? ` (${attempts})` : ''}
    </span>
  );
}
