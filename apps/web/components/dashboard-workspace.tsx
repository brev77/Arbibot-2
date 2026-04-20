'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';

import type { AuditListItem } from '@/lib/audit-types';
import { fetchOperatorBffJson } from '@/lib/operator-client-api';
import { operatorKeys } from '@/lib/operator-query-keys';
import type { ExecutionPlanListItem } from '@/lib/execution-types';
import type { OpportunityListItem } from '@/lib/opportunity-types';
import type { ListResponse } from '@/lib/server-api';
import type { DashboardSummary } from '@/lib/dashboard-types';

import { Button } from './ui/button';

export function DashboardWorkspace(): ReactNode {
  const opps = useQuery({
    queryKey: operatorKeys.opportunities,
    queryFn: () =>
      fetchOperatorBffJson<ListResponse<OpportunityListItem>>('/opportunities'),
  });
  const plans = useQuery({
    queryKey: operatorKeys.executionPlans,
    queryFn: () =>
      fetchOperatorBffJson<ListResponse<ExecutionPlanListItem>>(
        '/execution/plans',
      ),
  });
  const audit = useQuery({
    queryKey: operatorKeys.auditEntries(12),
    queryFn: () =>
      fetchOperatorBffJson<ListResponse<AuditListItem>>(
        '/audit/entries?limit=12',
      ),
  });
  const summary = useQuery({
    queryKey: operatorKeys.dashboardSummary,
    queryFn: () =>
      fetchOperatorBffJson<DashboardSummary>('/dashboard/summary'),
    staleTime: 30000,
  });
  const intakeHealth = useQuery({
    queryKey: operatorKeys.intakeDegradation,
    queryFn: () =>
      fetchOperatorBffJson<{
        tier: string;
        fallbackMode: boolean;
        throttledRate: number;
        intakeThrottlingEnabled: boolean;
        lastPolicyRefreshAtIso: string | null;
      }>('/health/degradation'),
    staleTime: 30000,
    refetchInterval: 30_000,
  });

  const oppItems = opps.data?.items ?? [];
  const preview = oppItems.slice(0, 6);
  const auditItems = audit.data?.items ?? [];
  const summaryData = summary.data ?? {
    incidentsOpenCount: 0,
    incidentsResolvedTodayCount: 0,
    capitalPositionsCount: 0,
    capitalTotalNotionalUsd: '0.00',
    lastUpdated: new Date().toISOString(),
  };

  return (
    <main className="px-6 py-6 text-slate-200 max-w-[1200px] mx-auto html.theme-light:text-slate-900">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mt-0 text-2xl font-semibold tracking-tight">
            Dashboard (M2)
          </h1>
          <p className="mb-0 text-sm text-slate-400 html.theme-light:text-slate-600">
            TanStack Query + `/api/operator/*` BFF — refetch without full page
            reload.
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
              void summary.refetch();
              void intakeHealth.refetch();
            }}
          >
            Refresh data
          </Button>
        </div>
      </div>

      <section className="mb-8">
        <h2 className="text-lg font-medium">Market intake (Phase 4)</h2>
        <p className="text-sm text-slate-400 html.theme-light:text-slate-600">
          Policy cache / throttling signals from{' '}
          <code className="text-xs">market-intake-service</code>.
        </p>
        {intakeHealth.isError ? (
          <p className="mt-2 text-sm text-amber-400">
            Could not load intake degradation (
            {intakeHealth.error instanceof Error
              ? intakeHealth.error.message
              : 'error'}
            ).
          </p>
        ) : intakeHealth.isPending ? (
          <p className="mt-2 text-sm text-slate-500">Loading intake status…</p>
        ) : (
          <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/50 p-4 text-sm html.theme-light:border-slate-200 html.theme-light:bg-slate-100">
            <div>
              <span className="text-slate-400">Tier: </span>
              <span className="font-medium">{intakeHealth.data.tier}</span>
              {intakeHealth.data.fallbackMode ? (
                <span className="ml-2 text-amber-400">(fallback)</span>
              ) : null}
            </div>
            <div className="mt-1">
              <span className="text-slate-400">Throttling: </span>
              {intakeHealth.data.intakeThrottlingEnabled ? 'on' : 'off'}
            </div>
            <div className="mt-1">
              <span className="text-slate-400">Throttle rate (1/s est.): </span>
              {intakeHealth.data.throttledRate.toFixed(4)}
            </div>
            {intakeHealth.data.lastPolicyRefreshAtIso !== null ? (
              <div className="mt-1 text-xs text-slate-500">
                Last policy refresh: {intakeHealth.data.lastPolicyRefreshAtIso}
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-medium">Incidents summary</h2>
        <p className="text-sm text-slate-400 html.theme-light:text-slate-600">
          Reconciliation mismatches — open count and resolved today.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 html.theme-light:border-slate-200 html.theme-light:bg-slate-100">
            <div className="text-2xl font-semibold text-sky-400">
              {summaryData.incidentsOpenCount}
            </div>
            <div className="text-sm text-slate-400">
              Open incidents
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 html.theme-light:border-slate-200 html.theme-light:bg-slate-100">
            <div className="text-2xl font-semibold text-green-400">
              {summaryData.incidentsResolvedTodayCount}
            </div>
            <div className="text-sm text-slate-400">
              Resolved today
            </div>
          </div>
        </div>
        <p className="mt-3">
          <Link href="/incidents" className="text-sm text-sky-400 hover:underline">
            Incidents workspace →
          </Link>
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-medium">Capital utilization</h2>
        <p className="text-sm text-slate-400 html.theme-light:text-slate-600">
          Portfolio positions — count and total notional USD.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 html.theme-light:border-slate-200 html.theme-light:bg-slate-100">
            <div className="text-2xl font-semibold text-amber-400">
              {summaryData.capitalPositionsCount}
            </div>
            <div className="text-sm text-slate-400">
              Active positions
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 html.theme-light:border-slate-200 html.theme-light:bg-slate-100">
            <div className="text-2xl font-semibold text-emerald-400">
              ${Number.parseFloat(summaryData.capitalTotalNotionalUsd).toLocaleString(
                'en-US',
                { minimumFractionDigits: 2, maximumFractionDigits: 2 },
              )}
            </div>
            <div className="text-sm text-slate-400">
              Total notional USD
            </div>
          </div>
        </div>
        <p className="mt-3">
          <Link href="/portfolio" className="text-sm text-sky-400 hover:underline">
            Portfolio workspace →
          </Link>
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-medium">Opportunities snapshot</h2>
        <p className="text-sm text-slate-400 html.theme-light:text-slate-600">
          Total loaded:{' '}
          {opps.isSuccess
            ? opps.data.items.length
            : opps.isError
              ? '— (error)'
              : '…'}
        </p>
        {preview.length > 0 ? (
          <ul className="mt-3 list-none space-y-2 p-0 text-[13px]">
            {preview.map((o) => (
              <li
                key={o.id}
                className="flex flex-wrap gap-4 border-b border-slate-800 py-1.5 html.theme-light:border-slate-200"
              >
                <Link
                  href={`/opportunities/${o.id}`}
                  className="text-sky-400 hover:underline"
                >
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
                <span className="text-slate-100 html.theme-light:text-slate-900">
                  {a.actor}
                </span>
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
    </main>
  );
}

