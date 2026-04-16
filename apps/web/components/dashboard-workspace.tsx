'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';

import type { AuditListItem } from '@/lib/audit-types';
import { fetchOperatorBffJson } from '@/lib/operator-client-api';
import { operatorKeys } from '@/lib/operator-query-keys';
import type { OpportunityListItem } from '@/lib/opportunity-types';
import type { ListResponse } from '@/lib/server-api';

import { Button } from './ui/button';

export function DashboardWorkspace(): ReactNode {
  const opps = useQuery({
    queryKey: operatorKeys.opportunities,
    queryFn: () =>
      fetchOperatorBffJson<ListResponse<OpportunityListItem>>('/opportunities'),
  });
  const plans = useQuery({
    queryKey: operatorKeys.executionPlans,
    queryFn: () => fetchOperatorBffJson<ListResponse<unknown>>('/execution/plans'),
  });
  const audit = useQuery({
    queryKey: operatorKeys.auditEntries(12),
    queryFn: () =>
      fetchOperatorBffJson<ListResponse<AuditListItem>>('/audit/entries?limit=12'),
  });

  const oppItems = opps.data?.items ?? [];
  const preview = oppItems.slice(0, 6);
  const auditItems = audit.data?.items ?? [];

  return (
    <main className="px-6 py-6 text-slate-200 max-w-[1200px] mx-auto html.theme-light:text-slate-900">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mt-0 text-2xl font-semibold tracking-tight">Dashboard (M1)</h1>
          <p className="mb-0 text-sm text-slate-400 html.theme-light:text-slate-600">
            TanStack Query + `/api/operator/*` BFF — refetch without full page reload.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void opps.refetch();
              void plans.refetch();
              void audit.refetch();
            }}
          >
            Refresh data
          </Button>
        </div>
      </div>

      <section className="mb-8">
        <h2 className="text-lg font-medium">Opportunities snapshot</h2>
        <p className="text-sm text-slate-400 html.theme-light:text-slate-600">
          Total loaded:{' '}
          {opps.isSuccess ? opps.data.items.length : opps.isError ? '— (error)' : '…'}
        </p>
        {preview.length > 0 ? (
          <ul className="mt-3 list-none space-y-2 p-0 text-[13px]">
            {preview.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap gap-4 border-b border-slate-800 py-1.5 html.theme-light:border-slate-200"
              >
                <Link href={`/opportunities/${o.id}`} className="text-sky-400 hover:underline">
                  {o.id.slice(0, 8)}…
                </Link>
                <span className="text-slate-400">{o.state}</span>
                <span className="text-slate-500">v{o.entityVersion}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3">
          <Link href="/opportunities" className="text-sm text-sky-400 hover:underline">
            Open opportunities workspace →
          </Link>
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-medium">Execution highlights</h2>
        <p className="text-sm text-slate-400 html.theme-light:text-slate-600">
          Plans:{' '}
          {plans.isSuccess
            ? plans.data.items.length
            : plans.isError
              ? '— (error)'
              : '…'}
        </p>
        <p className="mt-2">
          <Link href="/execution" className="text-sm text-sky-400 hover:underline">
            Execution workspace →
          </Link>
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-medium">Recent audit</h2>
        <p className="text-sm text-slate-400 html.theme-light:text-slate-600">
          Entries loaded:{' '}
          {audit.isSuccess
            ? audit.data.items.length
            : audit.isError
              ? '— (error)'
              : '…'}
        </p>
        {auditItems.length > 0 ? (
          <ul className="mt-3 list-none space-y-2 p-0 text-[13px]">
            {auditItems.slice(0, 8).map((a) => (
              <li
                key={a.id}
                className="border-b border-slate-800 py-1.5 html.theme-light:border-slate-200"
              >
                <span className="text-slate-100 html.theme-light:text-slate-900">{a.actor}</span>
                <span className="mx-2 text-slate-500">·</span>
                <span className="text-slate-400">{a.action}</span>
                {a.resourceId !== null ? (
                  <span className="ml-2 text-slate-500">
                    {a.resourceType ?? 'resource'} {a.resourceId.slice(0, 8)}…
                  </span>
                ) : null}
                <span className="ml-2 text-slate-500">{a.createdAt}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-medium">Incidents</h2>
        <p className="text-sm text-slate-400 html.theme-light:text-slate-600">
          Catalog links to reconciliation read model.
        </p>
        <p className="mt-2">
          <Link href="/incidents" className="text-sm text-sky-400 hover:underline">
            Incidents →
          </Link>
        </p>
      </section>

      <section>
        <h2 className="text-lg font-medium">Capital / portfolio</h2>
        <p className="text-sm text-slate-400 html.theme-light:text-slate-600">
          Portfolio API Phase 2 — placeholder section per spec §5.1.
        </p>
      </section>
    </main>
  );
}
