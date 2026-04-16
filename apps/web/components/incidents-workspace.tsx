'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';

import { fetchOperatorBffJson } from '@/lib/operator-client-api';
import { operatorKeys } from '@/lib/operator-query-keys';
import type { ReconciliationMismatchListItem } from '@/lib/reconciliation-types';
import type { ListResponse } from '@/lib/server-api';

import { Button } from './ui/button';

type StatusFilter = 'all' | 'open' | 'investigating' | 'resolved';

type RunDetectorsResult = {
  readonly inserted: number;
  readonly byKind?: Record<string, number>;
};

function mutationErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed';
}

export function IncidentsWorkspace(): ReactNode {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const q = useQuery({
    queryKey: operatorKeys.reconciliationMismatches,
    queryFn: () =>
      fetchOperatorBffJson<ListResponse<ReconciliationMismatchListItem>>(
        '/reconciliation/mismatches',
      ),
  });

  const runDetectors = useMutation({
    mutationFn: () =>
      fetchOperatorBffJson<RunDetectorsResult>('/reconciliation/mismatches/run-detectors', {
        method: 'POST',
        body: {},
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: operatorKeys.reconciliationMismatches,
      });
    },
  });

  const updateStatus = useMutation({
    mutationFn: (args: { id: string; status: 'investigating' | 'resolved'; version: number }) =>
      fetchOperatorBffJson<ReconciliationMismatchListItem>(
        `/reconciliation/mismatches/${args.id}`,
        {
          method: 'PATCH',
          body: {
            status: args.status,
            expectedEntityVersion: args.version,
          },
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: operatorKeys.reconciliationMismatches,
      });
    },
  });

  const filtered = useMemo(() => {
    const items = q.data?.items ?? [];
    if (statusFilter === 'all') {
      return items;
    }
    return items.filter((m) => m.status === statusFilter);
  }, [q.data?.items, statusFilter]);

  return (
    <main className="px-6 py-6 max-w-[960px] mx-auto text-slate-200 html.theme-light:text-slate-900">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mt-0 text-2xl font-semibold">Incidents</h1>
          <p className="mb-0 text-sm text-slate-400 html.theme-light:text-slate-600">
            Reconciliation mismatches via TanStack Query (`GET /mismatches` through BFF).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void runDetectors.mutate()}
            disabled={runDetectors.isPending}
          >
            {runDetectors.isPending ? 'Scanning…' : 'Run detectors'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void q.refetch()}
            disabled={q.isFetching}
          >
            {q.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {runDetectors.isError || updateStatus.isError ? (
        <section
          className="mb-4 rounded-lg border border-amber-900/40 bg-amber-950/20 p-4 html.theme-light:border-amber-200 html.theme-light:bg-amber-50"
          role="alert"
        >
          {runDetectors.isError ? (
            <p className="m-0 text-sm text-amber-200 html.theme-light:text-amber-900">
              Run detectors failed: {mutationErrorMessage(runDetectors.error)}
            </p>
          ) : null}
          {updateStatus.isError ? (
            <p
              className={`m-0 text-sm text-amber-200 html.theme-light:text-amber-900 ${runDetectors.isError ? 'mt-2' : ''}`}
            >
              Status update failed: {mutationErrorMessage(updateStatus.error)}
            </p>
          ) : null}
        </section>
      ) : null}

      {runDetectors.data !== undefined ? (
        <p className="mb-4 text-xs text-slate-500">
          Last scan: inserted {runDetectors.data.inserted}
          {runDetectors.data.byKind !== undefined
            ? ` — ${JSON.stringify(runDetectors.data.byKind)}`
            : ''}
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        <span className="text-slate-500">Status:</span>
        {(['all', 'open', 'investigating', 'resolved'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={
              statusFilter === s
                ? 'rounded border border-sky-600 px-2 py-0.5 text-sky-300'
                : 'rounded border border-slate-700 px-2 py-0.5 text-slate-400 hover:border-slate-500 html.theme-light:border-slate-300'
            }
            onClick={() => setStatusFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {q.isError ? (
        <section className="rounded-lg border border-slate-700 bg-slate-950/50 p-5 html.theme-light:border-slate-200 html.theme-light:bg-slate-50">
          <p className="m-0 text-sm text-slate-400">
            Reconciliation service unavailable — start <code>@arbibot/reconciliation-service</code>{' '}
            and migrations.
          </p>
        </section>
      ) : q.isSuccess && filtered.length === 0 ? (
        <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-8 text-center html.theme-light:border-slate-200 html.theme-light:bg-white">
          <p className="mt-0 text-slate-100 html.theme-light:text-slate-900">
            No mismatches for this filter
          </p>
          <p className="mb-0 text-sm text-slate-500">
            Table <code>reconciliation_mismatches</code> may be empty until you run detectors.
          </p>
        </section>
      ) : q.isSuccess ? (
        <ul className="m-0 list-none space-y-2 p-0 text-sm">
          {filtered.map((m) => {
            const planId =
              m.details !== null && typeof m.details.planId === 'string'
                ? m.details.planId
                : null;
            return (
              <li
                key={m.id}
                className="border-b border-slate-800 py-3 html.theme-light:border-slate-200"
              >
                <strong className="text-slate-100 html.theme-light:text-slate-900">{m.kind}</strong>{' '}
                <span className="text-slate-500">{m.status}</span>
                <div className="mt-1 text-xs text-slate-500">
                  {m.id} · v{m.entityVersion} · {m.createdAt}
                </div>
                {planId !== null ? (
                  <div className="mt-2">
                    <Link
                      href={`/execution/${planId}`}
                      className="text-sky-400 hover:underline text-xs font-mono"
                    >
                      Open plan {planId}
                    </Link>
                  </div>
                ) : null}
                {m.status === 'open' || m.status === 'investigating' ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.status === 'open' ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={updateStatus.isPending}
                        onClick={() =>
                          void updateStatus.mutate({
                            id: m.id,
                            status: 'investigating',
                            version: m.entityVersion,
                          })
                        }
                      >
                        Investigate
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={updateStatus.isPending}
                      onClick={() =>
                        void updateStatus.mutate({
                          id: m.id,
                          status: 'resolved',
                          version: m.entityVersion,
                        })
                      }
                    >
                      Mark resolved
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-slate-400">Loading…</p>
      )}

      <section className="mt-8">
        <h2 className="text-base font-medium">Audit trail</h2>
        <p className="text-sm text-slate-400 html.theme-light:text-slate-600">
          Append-only audit log complements mismatch detection.
        </p>
        <Link href="/dashboard" className="text-sm text-sky-400 hover:underline">
          Dashboard audit preview →
        </Link>
      </section>

      <section className="mt-8">
        <h2 className="text-base font-medium">Runbooks</h2>
        <Link href="/runbooks" className="text-sm text-sky-400 hover:underline">
          Runbooks →
        </Link>
      </section>
    </main>
  );
}
