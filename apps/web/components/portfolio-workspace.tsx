'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { fetchOperatorBffJson } from '@/lib/operator-client-api';
import { operatorKeys } from '@/lib/operator-query-keys';
import type { PortfolioPositionListItem } from '@/lib/portfolio-types';
import type { ListResponse } from '@/lib/server-api';

import { Button } from './ui/button';

export function PortfolioWorkspace(): ReactNode {
  const q = useQuery({
    queryKey: operatorKeys.portfolioPositions,
    queryFn: () =>
      fetchOperatorBffJson<ListResponse<PortfolioPositionListItem>>('/portfolio/positions'),
  });

  const items = q.data?.items ?? [];

  return (
    <main className="px-6 py-6 max-w-[960px] mx-auto text-slate-200 html.theme-light:text-slate-900">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mt-0 text-2xl font-semibold">Portfolio</h1>
          <p className="mb-0 text-sm text-slate-400 html.theme-light:text-slate-600">
            Positions from <code className="text-xs">portfolio-service</code> (confirmed fills
            only). Execution plans:{' '}
            <Link href="/execution" className="text-sky-400 hover:underline">
              /execution
            </Link>
            .
          </p>
        </div>
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

      {q.isError ? (
        <section className="rounded-lg border border-slate-700 bg-slate-950/50 p-5 html.theme-light:border-slate-200 html.theme-light:bg-slate-50">
          <p className="m-0 text-sm text-slate-400">
            Portfolio service unavailable — start <code>@arbibot/portfolio-service</code> and
            check <code>PORTFOLIO_API_BASE</code> for the BFF.
          </p>
        </section>
      ) : q.isSuccess && items.length === 0 ? (
        <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-8 text-center html.theme-light:border-slate-200 html.theme-light:bg-white">
          <p className="mt-0 text-slate-100 html.theme-light:text-slate-900">No open positions</p>
          <p className="mb-0 text-sm text-slate-500">
            Rows appear after settlement confirms fills (
            <code className="text-xs">EXECUTION_SETTLEMENT_ENABLED</code>).
          </p>
        </section>
      ) : q.isSuccess ? (
        <div className="overflow-x-auto rounded-lg border border-slate-800 html.theme-light:border-slate-200">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-slate-900/80 text-slate-400 html.theme-light:bg-slate-100 html.theme-light:text-slate-600">
              <tr>
                <th className="p-3 font-medium">Instrument key</th>
                <th className="p-3 font-medium">Qty</th>
                <th className="p-3 font-medium">Plan</th>
                <th className="p-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr
                  key={p.id}
                  className="border-t border-slate-800 html.theme-light:border-slate-200"
                >
                  <td className="p-3 font-mono text-xs text-slate-200 html.theme-light:text-slate-800">
                    {p.instrumentKey}
                  </td>
                  <td className="p-3 text-slate-200 html.theme-light:text-slate-900">{p.quantity}</td>
                  <td className="p-3">
                    <Link
                      href={`/execution/${p.planId}`}
                      className="text-sky-400 hover:underline font-mono text-xs"
                    >
                      {p.planId}
                    </Link>
                  </td>
                  <td className="p-3 text-xs text-slate-500">{p.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-400">Loading…</p>
      )}

      <section className="mt-10 rounded-lg border border-slate-800 p-5 html.theme-light:border-slate-200">
        <h2 className="mt-0 text-base font-medium">Dangerous actions</h2>
        <p className="text-sm text-slate-400 html.theme-light:text-slate-600">
          Force hedge / unwind remain gated on execution APIs with preview and audit (
          <code className="text-xs">§5.4</code>).
        </p>
      </section>
    </main>
  );
}
