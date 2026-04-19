'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useMemo } from 'react';

import type { PaperPromotionCandidateItem } from '@/lib/paper-types';

type Props = {
  readonly items: readonly PaperPromotionCandidateItem[];
};

export function PaperPromotionTable({ items }: Props): ReactNode {
  const columns = useMemo<ColumnDef<PaperPromotionCandidateItem>[]>(
    () => [
      {
        accessorKey: 'instrumentKey',
        header: 'Instrument',
        cell: (ctx) => (
          <span className="font-mono text-xs text-slate-200 html.theme-light:text-slate-800">
            {String(ctx.getValue<string>())}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: (ctx) => (
          <span className="text-xs uppercase tracking-wide text-slate-300 html.theme-light:text-slate-700">
            {String(ctx.getValue<string>())}
          </span>
        ),
      },
      {
        accessorKey: 'opportunityId',
        header: 'Opportunity',
        cell: (ctx) => {
          const id = ctx.getValue<string | null>();
          if (id === null || id.length === 0) {
            return <span className="text-xs text-slate-500">—</span>;
          }
          return (
            <Link
              href={`/opportunities/${id}`}
              className="font-mono text-xs text-sky-400 hover:underline"
            >
              {id.slice(0, 8)}…
            </Link>
          );
        },
      },
      {
        accessorKey: 'score',
        header: 'Score',
        cell: (ctx) => (
          <span className="text-xs text-slate-400">{String(ctx.getValue<string | null>() ?? '—')}</span>
        ),
      },
      {
        accessorKey: 'driftBps',
        header: 'Drift bps',
        cell: (ctx) => (
          <span className="text-xs text-slate-400">{String(ctx.getValue<string | null>() ?? '—')}</span>
        ),
      },
      {
        accessorKey: 'updatedAt',
        header: 'Updated',
        cell: (ctx) => {
          const v = ctx.getValue<string>();
          try {
            return (
              <span className="text-xs text-slate-500">{new Date(v).toLocaleString()}</span>
            );
          } catch {
            return <span className="text-xs text-slate-500">{v}</span>;
          }
        },
      },
    ],
    [],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table v8
  const table = useReactTable({
    data: items.length === 0 ? [] : [...items],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-slate-800 html.theme-light:border-slate-200">
              {hg.headers.map((h) => (
                <th key={h.id} className="py-2 pr-4 font-medium text-slate-400 html.theme-light:text-slate-600">
                  {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-slate-800/60 html.theme-light:border-slate-100"
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="py-2 pr-4 align-top">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
