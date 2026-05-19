'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';

import type { ExecutionPlanListItem } from '../lib/execution-types';
import {
  formatGasEth,
  getChainMeta,
  getExplorerTxUrl,
  getTxStatusBadge,
  getVenueBadge,
  truncateHash,
} from '../lib/dex-utils';

type Props = {
  readonly items: readonly ExecutionPlanListItem[];
};

function Badge({
  label,
  bg,
  text,
}: {
  readonly label: string;
  readonly bg: string;
  readonly text: string;
}): ReactNode {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: '18px',
        background: bg,
        color: text,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function ChainIcon({ chainId }: { readonly chainId: number }): ReactNode {
  const meta = getChainMeta(chainId);
  if (meta === null) {
    return <span style={{ fontSize: 12 }}>{chainId}</span>;
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 12,
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: meta.color,
          flexShrink: 0,
        }}
      />
      {meta.shortName}
    </span>
  );
}

export function ExecutionPlansTable({ items }: Props): ReactNode {
  const [globalFilter, setGlobalFilter] = useState('');

  const filtered = useMemo(() => {
    const q = globalFilter.trim().toLowerCase();
    if (q.length === 0) {
      return items;
    }
    return items.filter((row) => {
      const hay = `${row.id} ${row.correlationId ?? ''} ${row.capitalReservationId ?? ''} ${row.riskDecisionId ?? ''} ${row.state} ${row.venueType ?? ''} ${row.txHash ?? ''} ${row.chainId ?? ''} ${row.dexAdapter ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, globalFilter]);

  const columns = useMemo<ColumnDef<ExecutionPlanListItem>[]>(
    () => [
      {
        accessorKey: 'id',
        header: 'Plan',
        cell: (ctx) => (
          <Link
            href={`/execution/${ctx.getValue<string>()}`}
            style={{ color: '#38bdf8', textDecoration: 'none' }}
          >
            {String(ctx.getValue<string>()).slice(0, 8)}…
          </Link>
        ),
      },
      { accessorKey: 'state', header: 'State' },
      {
        accessorKey: 'venueType',
        header: 'Venue',
        cell: (ctx) => {
          const badge = getVenueBadge(ctx.getValue<string | null>());
          return <Badge label={badge.label} bg={badge.bg} text={badge.text} />;
        },
      },
      {
        accessorKey: 'chainId',
        header: 'Chain',
        cell: (ctx) => {
          const chainId = ctx.getValue<number | null>();
          if (chainId === null) return <span style={{ color: '#64748b' }}>—</span>;
          return <ChainIcon chainId={chainId} />;
        },
      },
      {
        accessorKey: 'txStatus',
        header: 'Tx Status',
        cell: (ctx) => {
          const status = ctx.getValue<string | null>();
          const badge = getTxStatusBadge(status);
          return <Badge label={badge.label} bg={badge.bg} text={badge.text} />;
        },
      },
      {
        accessorKey: 'txHash',
        header: 'Tx Hash',
        cell: (ctx) => {
          const txHash = ctx.getValue<string | null>();
          const chainId = ctx.row.original.chainId;
          if (txHash === null) return <span style={{ color: '#64748b' }}>—</span>;
          const url = getExplorerTxUrl(chainId, txHash);
          if (url.length === 0) return truncateHash(txHash);
          return (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#38bdf8', textDecoration: 'none', fontSize: 12 }}
            >
              {truncateHash(txHash)}
            </a>
          );
        },
      },
      {
        accessorKey: 'gasUsedWei',
        header: 'Gas',
        cell: (ctx) => {
          const gas = ctx.getValue<string | null>();
          const usd = ctx.row.original.gasCostUsd;
          if (gas === null && usd === null) return <span style={{ color: '#64748b' }}>—</span>;
          if (usd !== null && usd.length > 0) return `$${usd}`;
          return <span style={{ fontSize: 12 }}>{formatGasEth(gas)}</span>;
        },
      },
      {
        accessorKey: 'correlationId',
        header: 'Correlation',
        cell: (ctx) => ctx.getValue<string | null>() ?? '—',
      },
      {
        accessorKey: 'dexAdapter',
        header: 'Adapter',
        cell: (ctx) => {
          const v = ctx.getValue<string | null>();
          return v !== null && v.length > 0 ? v : '—';
        },
      },
      {
        accessorKey: 'capitalReservationId',
        header: 'Reservation',
        cell: (ctx) => {
          const v = ctx.getValue<string | null>();
          return v !== null && v.length > 0 ? `${v.slice(0, 8)}…` : '—';
        },
      },
      {
        accessorKey: 'riskDecisionId',
        header: 'Risk decision',
        cell: (ctx) => {
          const v = ctx.getValue<string | null>();
          return v !== null && v.length > 0 ? `${v.slice(0, 8)}…` : '—';
        },
      },
      {
        accessorKey: 'entityVersion',
        header: 'Ver.',
      },
      {
        accessorKey: 'updatedAt',
        header: 'Updated',
        cell: (ctx) => {
          const v = ctx.getValue<string>();
          try {
            return new Date(v).toLocaleString();
          } catch {
            return v;
          }
        },
      },
    ],
    [],
  );

  /* TanStack Table's useReactTable is marked incompatible with React Compiler memoization; behaviour is intentional. */
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table API
  const table = useReactTable({
    data: [...filtered],
    columns,
    getCoreRowModel: getCoreRowModel(),
    initialState: {
      columnVisibility: {
        correlationId: false,
        dexAdapter: false,
        txHash: false,
        gasUsedWei: false,
        capitalReservationId: false,
        riskDecisionId: false,
        entityVersion: false,
      },
    },
  });

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem', alignItems: 'flex-end' }}>
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            maxWidth: 420,
            fontSize: 13,
            color: '#94a3b8',
            flex: '1 1 280px',
          }}
        >
          Search
          <input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="id, state, venue, tx hash, chain, adapter…"
            style={{
              padding: '0.5rem 0.65rem',
              borderRadius: 6,
              border: '1px solid #334155',
              background: '#0f172a',
              color: '#e2e8f0',
            }}
          />
        </label>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    style={{
                      textAlign: 'left',
                      padding: '0.5rem 0.35rem',
                      borderBottom: '1px solid #334155',
                      color: '#94a3b8',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              const isDex = row.original.venueType === 'dex';
              return (
                <tr
                  key={row.id}
                  style={{
                    background: isDex ? 'rgba(88, 28, 135, 0.06)' : undefined,
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{
                        padding: '0.45rem 0.35rem',
                        borderBottom: '1px solid #1e293b',
                        verticalAlign: 'top',
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '0.75rem', fontSize: 12, color: '#64748b' }}>
        <span>
          Showing {table.getRowModel().rows.length} of {items.length} loaded plans
          (orchestrator caps list at 100).
        </span>
      </div>
    </div>
  );
}