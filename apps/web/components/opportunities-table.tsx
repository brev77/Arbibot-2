'use client';

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

import type { OpportunityListItem } from '../lib/opportunity-types';
import { useOperatorFiltersStore } from '../lib/operator-filters-store';

type Props = {
  readonly items: readonly OpportunityListItem[];
};

export function OpportunitiesTable({ items }: Props): ReactNode {
  const globalSearch = useOperatorFiltersStore((s) => s.opportunitySearch);
  const stateFilter = useOperatorFiltersStore((s) => s.opportunityState);

  const filtered = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    return items.filter((row) => {
      if (stateFilter.length > 0 && row.state !== stateFilter) {
        return false;
      }
      if (q.length === 0) {
        return true;
      }
      const hay = `${row.id} ${row.correlationId ?? ''} ${row.riskDecisionId ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, globalSearch, stateFilter]);

  const columns = useMemo<ColumnDef<OpportunityListItem>[]>(
    () => [
      {
        accessorKey: 'id',
        header: 'ID',
        cell: (ctx) => (
          <Link
            href={`/opportunities/${ctx.getValue<string>()}`}
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
        accessorKey: 'riskDecisionId',
        header: 'Risk decision',
        cell: (ctx) => ctx.getValue<string | null>() ?? '—',
      },
      {
        accessorKey: 'entityVersion',
        header: 'Ver.',
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
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

  // TanStack Table returns unstable function refs; React Compiler skips memoization — acceptable for this read-only grid.
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table v8
  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 13,
        }}
      >
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  style={{
                    textAlign: 'left',
                    padding: '0.5rem 0.75rem',
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
                    padding: '0.5rem 0.75rem',
                    borderBottom: '1px solid #1e293b',
                  }}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length === 0 ? (
        <p style={{ color: '#64748b', padding: '1rem 0.75rem' }}>
          No rows match the current filters.
        </p>
      ) : null}
    </div>
  );
}
