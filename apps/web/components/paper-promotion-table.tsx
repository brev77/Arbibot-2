'use client';

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import type { PaperPromotionCandidateItem } from '@/lib/paper-types';
import { Button } from './ui/button';

type Props = {
  readonly items: readonly PaperPromotionCandidateItem[];
  readonly onRefresh?: () => void;
};

export function PaperPromotionTable({ items, onRefresh }: Props): ReactNode {
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const handleAction = useCallback(
    async (id: string, action: 'approve' | 'reject') => {
      setActionLoading(id);
      try {
        const response = await fetch(
          `/api/operator/paper/promotion-candidates/${encodeURIComponent(id)}?action=${encodeURIComponent(action)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          },
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            (errorData as { error?: string }).error || `Failed to ${action} promotion candidate`,
          );
        }

        if (onRefresh) {
          onRefresh();
        }
      } catch (error) {
        console.error(`Failed to ${action} promotion candidate ${id}:`, error);
        alert(error instanceof Error ? error.message : `Failed to ${action} promotion candidate`);
      } finally {
        setActionLoading(null);
      }
    },
    [onRefresh],
  );

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
        cell: (ctx) => {
          const status = ctx.getValue<string>();
          const statusColors: Record<string, string> = {
            queued: 'text-yellow-600 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-900/30',
            under_review: 'text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30',
            promoted: 'text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/30',
            rejected: 'text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/30',
            expired: 'text-slate-600 bg-slate-100 dark:text-slate-400 dark:bg-slate-900/30',
          };
          return (
            <span
              className={`px-2 py-0.5 rounded text-xs uppercase tracking-wide ${statusColors[status] || 'text-slate-600 bg-slate-100'}`}
            >
              {status.replace('_', ' ')}
            </span>
          );
        },
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
        cell: (ctx) => {
          const drift = ctx.getValue<string | null>();
          if (drift === null) {
            return <span className="text-xs text-slate-500">—</span>;
          }
          const driftNum = Number(drift);
          const isHigh = Number.isFinite(driftNum) && driftNum > 30;
          return (
            <span className={`text-xs ${isHigh ? 'text-red-400 font-medium' : 'text-slate-400'}`}>
              {driftNum.toFixed(1)}
            </span>
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
      {
        id: 'actions',
        header: 'Actions',
        cell: (ctx) => {
          const row = ctx.row.original;
          const status = row.status;
          const isLoading = actionLoading === row.id;
          const canAct = status === 'queued' || status === 'under_review';

          if (!canAct) {
            return null;
          }

          return (
            <div className="flex gap-2">
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
