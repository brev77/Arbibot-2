'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { fetchOperatorBffJson } from '@/lib/operator-client-api';
import { operatorKeys } from '@/lib/operator-query-keys';
import type {
  PaperDriftSampleItem,
  PaperPromotionCandidateItem,
  PaperTradeListItem,
} from '@/lib/paper-types';
import type { ListResponse } from '@/lib/server-api';

import { PaperDriftTable } from './paper-drift-table';
import { PaperBffSectionFault, toOperatorBffError } from './paper-feed-error-hint';
import { PaperPromotionTable } from './paper-promotion-table';
import { PaperTradesTable } from './paper-trades-table';
import { Button } from './ui/button';

export function PaperWorkspace(): ReactNode {
  const driftLimit = 30;
  const tradesQ = useQuery({
    queryKey: operatorKeys.paperTrades,
    queryFn: () => fetchOperatorBffJson<ListResponse<PaperTradeListItem>>('/paper/trades'),
  });
  const promoQ = useQuery({
    queryKey: operatorKeys.paperPromotionCandidates,
    queryFn: () =>
      fetchOperatorBffJson<ListResponse<PaperPromotionCandidateItem>>('/paper/promotion-candidates'),
  });
  const driftQ = useQuery({
    queryKey: operatorKeys.paperDriftSamples(undefined, driftLimit),
    queryFn: () =>
      fetchOperatorBffJson<ListResponse<PaperDriftSampleItem>>(
        `/paper/drift-samples?limit=${driftLimit}`,
      ),
  });

  const busy = tradesQ.isFetching || promoQ.isFetching || driftQ.isFetching;

  return (
    <main className="px-6 py-6 max-w-[1100px] mx-auto text-slate-200 html.theme-light:text-slate-900">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mt-0 text-2xl font-semibold">Paper trading</h1>
          <p className="mb-0 text-sm text-slate-400 html.theme-light:text-slate-600">
            Read models from <code className="text-xs">paper-trading-service</code> (Phase 3).{' '}
            <Link href="/tokens" className="text-sky-400 hover:underline">
              Token promotion queue
            </Link>
            .
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            void Promise.all([tradesQ.refetch(), promoQ.refetch(), driftQ.refetch()]);
          }}
          disabled={busy}
        >
          {busy ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <section className="mb-10">
        <h2 className="mt-0 text-base font-medium">Paper trades</h2>
        <p className="text-sm text-slate-500 mb-3">
          Virtual trades (isolated from live capital reservations). Writes use operator/API flows outside this
          read-only UI slice.
        </p>
        {tradesQ.isError ? (
          <PaperBffSectionFault label="Failed to load paper trades." error={toOperatorBffError(tradesQ.error)} />
        ) : tradesQ.isPending ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : tradesQ.data.items.length === 0 ? (
          <p className="text-sm text-slate-500">No paper trades yet.</p>
        ) : (
          <PaperTradesTable items={tradesQ.data.items} onRefresh={() => void tradesQ.refetch()} />
        )}
      </section>

      <section className="mb-10">
        <h2 className="mt-0 text-base font-medium">Promotion queue</h2>
        <p className="text-sm text-slate-500 mb-3">
          Candidates for paper-only discovery → live promotion (opportunity{' '}
          <code className="text-xs">POST …/paper-enqueue</code> writes outbox; relay posts to paper when{' '}
          <code className="text-xs">PAPER_TRADING_SERVICE_URL</code> is set).
        </p>
        {promoQ.isError ? (
          <PaperBffSectionFault
            label="Failed to load promotion candidates."
            error={toOperatorBffError(promoQ.error)}
          />
        ) : promoQ.isPending ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : promoQ.data.items.length === 0 ? (
          <p className="text-sm text-slate-500">No promotion candidates.</p>
        ) : (
          <div className="rounded-lg border border-slate-800 html.theme-light:border-slate-200 p-2">
            <PaperPromotionTable items={promoQ.data.items} onRefresh={() => void promoQ.refetch()} />
          </div>
        )}
      </section>

      <section>
        <h2 className="mt-0 text-base font-medium">Drift samples (paper vs reference)</h2>
        <p className="text-sm text-slate-500 mb-3">
          Recent rows feed observability counter <code className="text-xs">arb_paper_drift_samples_recorded_total</code>
          .
        </p>
        {driftQ.isError ? (
          <PaperBffSectionFault label="Failed to load drift samples." error={toOperatorBffError(driftQ.error)} />
        ) : driftQ.isPending ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : driftQ.data.items.length === 0 ? (
          <p className="text-sm text-slate-500">No drift samples recorded.</p>
        ) : (
          <PaperDriftTable items={driftQ.data.items} />
        )}
      </section>
    </main>
  );
}
