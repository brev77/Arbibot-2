'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import type { PaperTradeListItem } from '@/lib/paper-types';
import { Button } from './ui/button';

type Props = {
  readonly items: readonly PaperTradeListItem[];
  readonly onRefresh?: () => void;
};

export function PaperTradesTable({ items, onRefresh }: Props): ReactNode {
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleAction = useCallback(
    async (id: string, action: 'approve' | 'reject' | 'cancel') => {
      setActionLoading(id);
      try {
        const response = await fetch(
          `/api/operator/paper/trades/${encodeURIComponent(id)}?action=${encodeURIComponent(action)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error((errorData as { error?: string }).error || `Failed to ${action} paper trade`);
        }

        if (onRefresh) {
          onRefresh();
        }
      } catch (error) {
        console.error(`Failed to ${action} paper trade ${id}:`, error);
        alert(error instanceof Error ? error.message : `Failed to ${action} paper trade`);
      } finally {
        setActionLoading(null);
      }
    },
    [onRefresh],
  );

  const columns = useMemo<ColumnDef<PaperTradeListItem>[]>(
    () => [
      {
        accessorKey: 'instrumentKey',
        header: 'Instrument',
        cell: (ctx) => (
          <span className="font-mono text-xs text-slate-200 html.theme-light:text-slate-900">
            {String(ctx.getValue<string>())}
          </span>
        ),
      },
      {
        accessorKey: 'state',
        header: 'State',
        cell: (ctx) => {
          const state = ctx.getValue<string>();
          const stateColors: Record<string, string> = {
            draft: 'text-yellow-600 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-900/30',
            active: 'text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/30',
            settled: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30',
            canceled: 'text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/30',
          };
          return (
            <span className={`px-2 py-0.5 rounded text-xs uppercase ${stateColors[state] || 'text-slate-600 bg-slate-100'}`}>
              {state}
            </span>
          );
        },
      },
      {
        accessorKey: 'notional',
        header: 'Notional',
        cell: (ctx) => (
          <span className="text-xs text-slate-400 html.theme-light:text-slate-600">
            {String(ctx.getValue<string>())}
          </span>
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
      {
        id: 'actions',
        header: 'Actions',
        cell: (ctx) => {
          const row = ctx.row.original;
          const state = row.state;
          const isLoading = actionLoading === row.id;

          return (
            <div className="flex gap-2">
              {state === 'draft' && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void handleAction(row.id, 'approve');
                    }}
                    disabled={isLoading}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void handleAction(row.id, 'reject');
                    }}
                    disabled={isLoading}
                  >
                    Reject
                  </Button>
                </>
              )}
              {state === 'active' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    void handleAction(row.id, 'cancel');
                  }}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [actionLoading, handleAction],
  );

  const table = useReactTable({
    data: items.length === 0 ? [] : [...items],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800 html.theme-light:border-slate-200">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-slate-800 html.theme-light:border-slate-200">
              {hg.headers.map((h) => (
                <th key={h.id} className="p-3 font-medium text-slate-400 html.theme-light:text-slate-600">
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
