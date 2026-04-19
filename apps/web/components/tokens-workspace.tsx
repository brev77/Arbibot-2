'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { fetchOperatorBffJson } from '@/lib/operator-client-api';
import { operatorKeys } from '@/lib/operator-query-keys';
import type { PaperPromotionCandidateItem } from '@/lib/paper-types';
import type { ListResponse } from '@/lib/server-api';

import { PaperBffSectionFault, toOperatorBffError } from './paper-feed-error-hint';
import { PaperPromotionTable } from './paper-promotion-table';
import { Button } from './ui/button';

export function TokensWorkspace(): ReactNode {
  const q = useQuery({
    queryKey: operatorKeys.paperPromotionCandidates,
    queryFn: () =>
      fetchOperatorBffJson<ListResponse<PaperPromotionCandidateItem>>('/paper/promotion-candidates'),
  });

  return (
    <main className="px-6 py-6 max-w-[960px] mx-auto text-slate-200 html.theme-light:text-slate-900">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mt-0 text-2xl font-semibold">Tokens</h1>
          <p className="mb-0 text-sm text-slate-400 html.theme-light:text-slate-600">
            Promotion queue (read-only slice; full token lifecycle and controls stay behind preview + approval when
            APIs land).{' '}
            <Link href="/paper" className="text-sky-400 hover:underline">
              Paper overview
            </Link>
            .
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {q.isError ? (
        <PaperBffSectionFault
          label="Failed to load promotion queue."
          error={toOperatorBffError(q.error)}
        />
      ) : q.isPending ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : q.data.items.length === 0 ? (
        <section className="rounded-lg border border-slate-800 bg-slate-950/40 p-8 text-center html.theme-light:border-slate-200 html.theme-light:bg-white">
          <p className="mt-0 text-slate-100 html.theme-light:text-slate-900">No promotion candidates</p>
          <p className="mb-0 text-sm text-slate-500">
            Enqueue via opportunity hook or direct paper API when configured.
          </p>
        </section>
      ) : (
        <div className="rounded-lg border border-slate-800 html.theme-light:border-slate-200 p-2">
          <PaperPromotionTable items={q.data.items} />
        </div>
      )}
    </main>
  );
}
