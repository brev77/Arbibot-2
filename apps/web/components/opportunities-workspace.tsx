'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { OpportunitiesTable } from '@/components/opportunities-table';
import { fetchOperatorBffJson } from '@/lib/operator-client-api';
import { operatorKeys } from '@/lib/operator-query-keys';
import type { OpportunityListItem } from '@/lib/opportunity-types';
import type { ListResponse } from '@/lib/server-api';

import { Button } from './ui/button';

export function OpportunitiesWorkspace(): ReactNode {
  const q = useQuery({
    queryKey: operatorKeys.opportunities,
    queryFn: () =>
      fetchOperatorBffJson<ListResponse<OpportunityListItem>>('/opportunities'),
  });

  return (
    <main className="px-6 py-6 max-w-[1200px] mx-auto text-slate-200 html.theme-light:text-slate-900">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mt-0 text-2xl font-semibold">Opportunities</h1>
          <p className="mb-0 text-sm text-slate-400 html.theme-light:text-slate-600">
            Server state via TanStack Query (BFF <code className="text-xs">/api/operator</code>
            ). Toolbar filters apply client-side in the table.
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
          Could not load opportunities — check opportunity-service and BFF env bases.
        </p>
      ) : q.isSuccess ? (
        <OpportunitiesTable items={q.data.items} />
      ) : (
        <p className="text-sm text-slate-400">Loading…</p>
      )}
    </main>
  );
}
