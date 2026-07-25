'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { ScannerFindingsTable } from '@/components/scanner-findings-table';
import { ScannerInstancesTable } from '@/components/scanner-instances-table';
import { fetchOperatorBffJson } from '@/lib/operator-client-api';
import { operatorKeys } from '@/lib/operator-query-keys';
import type {
  ScannerActionResult,
  ScannerFinding,
  ScannerInstancesResponse,
  ScannerStatusResponse,
} from '@/lib/scanner-types';

import { Button } from './ui/button';

/**
 * Operator workspace for scanner-service (S4-3-UI).
 *
 * Two sections: instances table (config join runtime, with Run / Refresh-config actions) and
 * findings table (latest cross-venue deals, with re-publish for stuck findings). All reads come
 * from the BFF (`/api/operator/scanners/*`) via React Query; mutations invalidate the relevant
 * query keys. A status bar shows the worker shutdown state + currently-running instance ids.
 */
export function ScannersWorkspace(): ReactNode {
  const qc = useQueryClient();
  const [findingsInstance, setFindingsInstance] = useState<string>('');
  const [findingsStatus, setFindingsStatus] = useState<string>('');
  const [busyInstanceId, setBusyInstanceId] = useState<string | null>(null);
  const [republishBusyId, setRepublishBusyId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string>('');

  const instancesQ = useQuery({
    queryKey: operatorKeys.scannerInstances,
    queryFn: () =>
      fetchOperatorBffJson<ScannerInstancesResponse>('/scanners/instances'),
    refetchInterval: 15_000,
  });

  const statusQ = useQuery({
    queryKey: operatorKeys.scannerStatus,
    queryFn: () =>
      fetchOperatorBffJson<ScannerStatusResponse>('/scanners/status'),
    refetchInterval: 5_000,
  });

  const findingsQ = useQuery({
    queryKey: operatorKeys.scannerFindings(findingsInstance, findingsStatus),
    queryFn: () => {
      const params = new URLSearchParams();
      if (findingsInstance.length > 0) params.set('instanceId', findingsInstance);
      if (findingsStatus.length > 0) params.set('publishStatus', findingsStatus);
      params.set('limit', '100');
      const qs = params.toString().length > 0 ? `?${params.toString()}` : '';
      return fetchOperatorBffJson<ScannerFinding[]>(`/scanners/findings${qs}`);
    },
    refetchInterval: 15_000,
  });

  const runningInstanceIds = useMemo(
    () => new Set(statusQ.data?.runningInstanceIds ?? []),
    [statusQ.data?.runningInstanceIds],
  );

  const runMutation = useMutation({
    mutationFn: (instanceId: string) => {
      setBusyInstanceId(instanceId);
      return fetchOperatorBffJson<ScannerActionResult>(
        `/scanners/instances/${encodeURIComponent(instanceId)}/run`,
        { method: 'POST' },
      );
    },
    onSuccess: (data) => {
      setActionMessage(data.message ?? 'Cycle triggered');
      void qc.invalidateQueries({ queryKey: operatorKeys.scannerInstances });
      void qc.invalidateQueries({ queryKey: operatorKeys.scannerFindings() });
      void qc.invalidateQueries({ queryKey: operatorKeys.scannerStatus });
    },
    onError: (err: unknown) => {
      setActionMessage(
        `Run failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
    onSettled: () => setBusyInstanceId(null),
  });

  const refreshConfigMutation = useMutation({
    mutationFn: (instanceId: string) => {
      setBusyInstanceId(instanceId);
      return fetchOperatorBffJson<ScannerActionResult>(
        `/scanners/instances/${encodeURIComponent(instanceId)}/refresh-config`,
        { method: 'POST' },
      );
    },
    onSuccess: (data) => {
      setActionMessage(data.message ?? 'Config refreshed');
      void qc.invalidateQueries({ queryKey: operatorKeys.scannerInstances });
    },
    onError: (err: unknown) => {
      setActionMessage(
        `Refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
    onSettled: () => setBusyInstanceId(null),
  });

  const republishMutation = useMutation({
    mutationFn: (findingId: string) => {
      setRepublishBusyId(findingId);
      return fetchOperatorBffJson<ScannerActionResult>(
        `/scanners/findings/${encodeURIComponent(findingId)}/re-publish`,
        { method: 'POST' },
      );
    },
    onSuccess: (data) => {
      setActionMessage(
        data.published === true
          ? `Re-published → ${data.opportunityId ?? 'new opportunity'}`
          : (data.message ?? 'Re-publish attempted'),
      );
      void qc.invalidateQueries({ queryKey: operatorKeys.scannerFindings() });
    },
    onError: (err: unknown) => {
      setActionMessage(
        `Re-publish failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    },
    onSettled: () => setRepublishBusyId(null),
  });

  const instanceOptions = instancesQ.data?.instances ?? [];

  return (
    <main className="px-6 py-6 max-w-[1200px] mx-auto text-slate-200 html.theme-light:text-slate-900">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mt-0 text-2xl font-semibold">Scanners</h1>
          <p className="mb-0 text-sm text-slate-400 html.theme-light:text-slate-600">
            Cross-DEX spread detector. Instances are defined in config-service; findings flow to{' '}
            <code className="text-xs">POST /opportunities</code>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void instancesQ.refetch();
              void statusQ.refetch();
              void findingsQ.refetch();
            }}
          >
            Refresh all
          </Button>
        </div>
      </div>

      {actionMessage.length > 0 ? (
        <p className="mb-3 text-xs text-sky-400 html.theme-light:text-sky-700">
          {actionMessage}
        </p>
      ) : null}

      <section className="mb-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 html.theme-light:text-slate-600">
            Instances
          </h2>
          {statusQ.data !== undefined ? (
            <span className="text-xs text-slate-400 html.theme-light:text-slate-600">
              {statusQ.data.isShuttingDown
                ? 'worker shutting down'
                : `${statusQ.data.scheduledInstanceIds.length} scheduled · ${statusQ.data.runningInstanceIds.length} running`}
            </span>
          ) : null}
        </div>
        {instancesQ.isError ? (
          <p className="text-sm text-amber-400">
            Could not load instances — check scanner-service and{' '}
            <code className="text-xs">SCANNER_API_BASE</code>.
          </p>
        ) : instancesQ.isSuccess ? (
          <ScannerInstancesTable
            instances={instanceOptions}
            status={statusQ.data}
            runningInstanceIds={runningInstanceIds}
            onRun={(id) => runMutation.mutate(id)}
            onRefreshConfig={(id) => refreshConfigMutation.mutate(id)}
            runningBusyId={busyInstanceId}
          />
        ) : (
          <p className="text-sm text-slate-400">Loading instances…</p>
        )}
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400 html.theme-light:text-slate-600">
            Findings
          </h2>
          <div className="flex gap-2 text-xs">
            <select
              className="bg-slate-900 html.theme-light:bg-slate-100 border border-slate-700 html.theme-light:border-slate-300 rounded px-2 py-1"
              value={findingsInstance}
              onChange={(e) => setFindingsInstance(e.target.value)}
              aria-label="Filter by instance"
            >
              <option value="">All instances</option>
              {instanceOptions.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.id}
                </option>
              ))}
            </select>
            <select
              className="bg-slate-900 html.theme-light:bg-slate-100 border border-slate-700 html.theme-light:border-slate-300 rounded px-2 py-1"
              value={findingsStatus}
              onChange={(e) => setFindingsStatus(e.target.value)}
              aria-label="Filter by publish status"
            >
              <option value="">Any status</option>
              <option value="pending">pending</option>
              <option value="published">published</option>
              <option value="failed">failed</option>
            </select>
          </div>
        </div>
        {findingsQ.isError ? (
          <p className="text-sm text-amber-400">
            Could not load findings — check scanner-service.
          </p>
        ) : findingsQ.isSuccess ? (
          <ScannerFindingsTable
            findings={findingsQ.data}
            onRepublish={(id) => republishMutation.mutate(id)}
            republishBusyId={republishBusyId}
          />
        ) : (
          <p className="text-sm text-slate-400">Loading findings…</p>
        )}
      </section>
    </main>
  );
}
