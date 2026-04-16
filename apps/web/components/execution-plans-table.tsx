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

type Props = {
  readonly items: readonly ExecutionPlanListItem[];
};

export function ExecutionPlansTable({ items }: Props): ReactNode {
  const [globalFilter, setGlobalFilter] = useState('');

  const filtered = useMemo(() => {
    const q = globalFilter.trim().toLowerCase();
    if (q.length === 0) {
      return items;
    }
    return items.filter((row) => {
      const hay = `${row.id} ${row.correlationId ?? ''} ${row.capitalReservationId ?? ''} ${row.riskDecisionId ?? ''} ${row.state}`.toLowerCase();
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
        accessorKey: 'correlationId',
        header: 'Correlation',
        cell: (ctx) => ctx.getValue<string | null>() ?? '—',
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

  const table = useReactTable({
    data: [...filtered],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div>
      <label
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          marginBottom: '1rem',
          maxWidth: 420,
          fontSize: 13,
          color: '#94a3b8',
        }}
      >
        Search
        <input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="id, correlation, reservation, state…"
          style={{
            padding: '0.5rem 0.65rem',
            borderRadius: 6,
            border: '1px solid #334155',
            background: '#0f172a',
            color: '#e2e8f0',
          }}
        />
      </label>
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
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
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
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ color: '#64748b', fontSize: 12, marginTop: '0.75rem' }}>
        Showing {table.getRowModel().rows.length} of {items.length} loaded plans
        (orchestrator caps list at 100).
      </p>
    </div>
  );
}
