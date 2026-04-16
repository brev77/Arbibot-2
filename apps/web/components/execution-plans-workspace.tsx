'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ExecutionPlansTable } from '@/components/execution-plans-table';
import type { ExecutionPlanListItem } from '@/lib/execution-types';
import { fetchOperatorBffJson } from '@/lib/operator-client-api';
import { operatorKeys } from '@/lib/operator-query-keys';
import type { ListResponse } from '@/lib/server-api';

import { Button } from './ui/button';

export function ExecutionPlansWorkspace(): ReactNode {
  const q = useQuery({
    queryKey: operatorKeys.executionPlans,
    queryFn: () =>
      fetchOperatorBffJson<ListResponse<ExecutionPlanListItem>>('/execution/plans'),
  });

  return (
    <main className="px-6 py-6 max-w-[1200px] mx-auto text-slate-200 html.theme-light:text-slate-900">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mt-0 text-2xl font-semibold">Execution</h1>
          <p className="mb-0 text-sm text-slate-400 html.theme-light:text-slate-600">
            Read-only plans via React Query. Detail routes stay RSC for correct 404
            handling.
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
        <p className="text-sm text-amber-400">
          Execution orchestrator unreachable — check BFF and `EXECUTION_API_BASE`.
        </p>
      ) : q.isSuccess ? (
        <ExecutionPlansTable items={q.data.items} />
      ) : (
        <p className="text-sm text-slate-400">Loading…</p>
      )}
    </main>
  );
}
