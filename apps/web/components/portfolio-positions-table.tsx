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

import type { PortfolioPositionListItem } from '../lib/portfolio-types';

type Props = {
  readonly items: readonly PortfolioPositionListItem[];
};

export function PortfolioPositionsTable({ items }: Props): ReactNode {
  const columns = useMemo<ColumnDef<PortfolioPositionListItem>[]>(
    () => [
      {
        accessorKey: 'instrumentKey',
        header: 'Instrument key',
        cell: (ctx) => (
          <span className="font-mono text-xs text-slate-200 html.theme-light:text-slate-800">
            {String(ctx.getValue<string>())}
          </span>
        ),
      },
      {
        accessorKey: 'quantity',
        header: 'Qty',
        cell: (ctx) => (
          <span className="text-slate-200 html.theme-light:text-slate-900">
            {String(ctx.getValue<string>())}
          </span>
        ),
      },
      {
        accessorKey: 'planId',
        header: 'Plan',
        cell: (ctx) => {
          const planId = ctx.getValue<string>();
          return (
            <Link
              href={`/execution/${planId}`}
              className="font-mono text-xs text-sky-400 hover:underline"
            >
              {planId}
            </Link>
          );
        },
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
    data: [...items],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-slate-900/80 text-slate-400 html.theme-light:bg-slate-100 html.theme-light:text-slate-600">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} className="p-3 font-medium">
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
            <tr
              key={row.id}
              className="border-t border-slate-800 html.theme-light:border-slate-200"
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="p-3 align-top">
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
