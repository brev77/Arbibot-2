'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { DestructiveOperatorAction } from '@/components/destructive-operator-action';
import { Button } from '@/components/ui/button';
import { fetchOperatorBffJson } from '@/lib/operator-client-api';
import { operatorKeys } from '@/lib/operator-query-keys';
import type {
  HermesApprovalsQueue,
  HermesDashboardSummary,
  HermesIncidentBriefs,
  HermesPlansPage,
  HermesPositionsPage,
  HermesSafeModeStatus,
  HermesSessionsInfo,
} from '@/lib/hermes-types';

function PositionCloseAction(props: {
  readonly positionId: string;
  readonly instrumentKey: string;
  readonly quantity: string;
  readonly entityVersion: number;
}): ReactNode {
  const qc = useQueryClient();
  const q = Number.parseFloat(props.quantity);
  const canClose = Number.isFinite(q) && q !== 0;

  const close = useMutation({
    mutationFn: () =>
      fetchOperatorBffJson<unknown>(
        `/hermes/v1/positions/${props.positionId}/close`,
        {
          method: 'POST',
          body: {
            expectedEntityVersion: props.entityVersion,
            approveReason: 'operator_close_via_hermes',
          },
        },
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: operatorKeys.hermesPositions });
    },
  });

  if (!canClose) {
    return <span className="text-xs text-muted-foreground">flat</span>;
  }

  return (
    <DestructiveOperatorAction
      level="high"
      actionLabel="Close position"
      requireTypedConfirmPhrase="CLOSE"
      impactPreview={{
        affectedResources: `${props.instrumentKey} position ${props.positionId}`,
        potentialConsequences:
          'Position quantity will be set to zero in portfolio-service (operator close).',
        mitigation: 'Confirm this matches venue / reconciliation state.',
      }}
      disabled={close.isPending}
      onConfirm={() => close.mutateAsync()}
    />
  );
}

function PlanRow(props: { row: Record<string, unknown> }): ReactNode {
  const id = typeof props.row.id === 'string' ? props.row.id : '';
  const state = typeof props.row.state === 'string' ? props.row.state : '';
  return (
    <tr className="border-b border-border">
      <td className="px-2 py-1 font-mono text-xs">{id || '—'}</td>
      <td className="px-2 py-1 text-sm text-muted-foreground">{state}</td>
      <td className="px-2 py-1 text-right">
        <HermesPlanActions planId={id} state={state} />
      </td>
    </tr>
  );
}

function HermesPlanActions(props: {
  readonly planId: string;
  readonly state: string;
}): ReactNode {
  const qc = useQueryClient();
  const canArm = props.planId.length > 0 && props.state === 'reserved';
  const canExecute = props.planId.length > 0 && props.state === 'armed';

  const arm = useMutation({
    mutationFn: () =>
      fetchOperatorBffJson<unknown>(`/hermes/v1/plans/${props.planId}/arm`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: operatorKeys.hermesPlans(50) });
    },
  });

  const execute = useMutation({
    mutationFn: () =>
      fetchOperatorBffJson<unknown>(
        `/hermes/v1/plans/${props.planId}/execute`,
        { method: 'POST', body: {} },
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: operatorKeys.hermesPlans(50) });
    },
  });

  if (!canArm && !canExecute) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <div className="flex flex-wrap justify-end gap-1">
      {canArm && (
        <DestructiveOperatorAction
          level="high"
          actionLabel="Arm plan"
          requireTypedConfirmPhrase="ARM"
          impactPreview={{
            affectedResources: `Plan ${props.planId}`,
            potentialConsequences: 'Capital may be committed per policy when execution begins.',
            mitigation: 'Verify risk and capital reservations before arming.',
          }}
          disabled={arm.isPending}
          onConfirm={() => arm.mutateAsync()}
        />
      )}
      {canExecute && (
        <DestructiveOperatorAction
          level="high"
          actionLabel="Begin execution"
          requireTypedConfirmPhrase="EXECUTE"
          impactPreview={{
            affectedResources: `Plan ${props.planId}`,
            potentialConsequences: 'Legs may be sent to venues per playbook.',
            mitigation: 'Confirm venue health and incident status.',
          }}
          disabled={execute.isPending}
          onConfirm={() => execute.mutateAsync()}
        />
      )}
    </div>
  );
}

export function HermesWorkspace(): ReactNode {
  const qc = useQueryClient();
  const plans = useQuery({
    queryKey: operatorKeys.hermesPlans(50),
    queryFn: () =>
      fetchOperatorBffJson<HermesPlansPage>('/hermes/v1/plans?limit=50'),
  });
  const dashboard = useQuery({
    queryKey: operatorKeys.hermesDashboard,
    queryFn: () =>
      fetchOperatorBffJson<HermesDashboardSummary>(
        '/hermes/v1/dashboard/summary',
      ),
    staleTime: 30_000,
  });
  const briefs = useQuery({
    queryKey: operatorKeys.hermesIncidentBriefs,
    queryFn: () =>
      fetchOperatorBffJson<HermesIncidentBriefs>(
        '/hermes/v1/incident-briefs',
      ),
    staleTime: 20_000,
  });
  const approvals = useQuery({
    queryKey: operatorKeys.hermesApprovalsQueue(40),
    queryFn: () =>
      fetchOperatorBffJson<HermesApprovalsQueue>(
        '/hermes/v1/approvals-queue?limit=40',
      ),
    staleTime: 15_000,
  });
  const safeMode = useQuery({
    queryKey: operatorKeys.hermesSafeMode,
    queryFn: () =>
      fetchOperatorBffJson<HermesSafeModeStatus>(
        '/hermes/v1/safe-mode/status',
      ),
    refetchInterval: 15_000,
  });
  const sessions = useQuery({
    queryKey: operatorKeys.hermesSessions,
    queryFn: () =>
      fetchOperatorBffJson<HermesSessionsInfo>('/hermes/v1/sessions'),
  });
  const positions = useQuery({
    queryKey: operatorKeys.hermesPositions,
    queryFn: () =>
      fetchOperatorBffJson<HermesPositionsPage>('/hermes/v1/positions'),
    staleTime: 15_000,
  });

  const enableSafe = useMutation({
    mutationFn: () =>
      fetchOperatorBffJson<unknown>('/hermes/v1/safe-mode/enable', {
        method: 'POST',
        body: { reason: 'operator_ui' },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: operatorKeys.hermesSafeMode });
    },
  });
  const disableSafe = useMutation({
    mutationFn: () =>
      fetchOperatorBffJson<unknown>('/hermes/v1/safe-mode/disable', {
        method: 'POST',
        body: { reason: 'operator_ui' },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: operatorKeys.hermesSafeMode });
    },
  });

  const gatewayMissing =
    (plans.error instanceof Error && plans.error.message.includes('503')) ||
    (dashboard.error instanceof Error &&
      dashboard.error.message.includes('503'));

  const planItems = plans.data?.items ?? [];
  const rows = planItems.filter(
    (it): it is Record<string, unknown> =>
      typeof it === 'object' && it !== null && !Array.isArray(it),
  );

  return (
    <main className="p-6 md:p-8 max-w-[1200px] mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Hermes</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Phase 5 — operator assist via gateway (
          <code className="text-xs">/hermes/v1</code>). Mutations are
          approval-gated and audited.
        </p>
      </header>

      {gatewayMissing && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Gateway BFF not configured: set{' '}
          <code className="text-xs">HERMES_GATEWAY_URL</code> and{' '}
          <code className="text-xs">HERMES_BFF_API_KEY</code> for{' '}
          <code className="text-xs">apps/web</code> (server-side).
        </p>
      )}

      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium">Safe mode</h2>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={enableSafe.isPending || safeMode.data?.safeMode.enabled}
              onClick={() => void enableSafe.mutateAsync()}
            >
              Enable
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disableSafe.isPending || !safeMode.data?.safeMode.enabled}
              onClick={() => void disableSafe.mutateAsync()}
            >
              Disable
            </Button>
          </div>
        </div>
        {safeMode.data !== undefined && (
          <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Enabled</dt>
              <dd>{safeMode.data.safeMode.enabled ? 'yes' : 'no'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Updated</dt>
              <dd className="font-mono text-xs">
                {safeMode.data.safeMode.updatedAt}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h2 className="text-lg font-medium">Portfolio positions</h2>
        {positions.isLoading && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {positions.error !== null && (
          <p className="text-sm text-destructive">
            {positions.error instanceof Error
              ? positions.error.message
              : String(positions.error)}
          </p>
        )}
        {(positions.data?.items ?? []).length === 0 &&
          !positions.isLoading &&
          positions.error === null && (
            <p className="text-sm text-muted-foreground">No open positions.</p>
          )}
        {(positions.data?.items ?? []).length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-2 py-1">Instrument</th>
                  <th className="px-2 py-1">Quantity</th>
                  <th className="px-2 py-1">Plan</th>
                  <th className="px-2 py-1 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(positions.data?.items ?? []).map((p) => (
                  <tr key={p.id} className="border-b border-border">
                    <td className="px-2 py-1 font-mono text-xs">{p.instrumentKey}</td>
                    <td className="px-2 py-1">{p.quantity}</td>
                    <td className="px-2 py-1 font-mono text-xs">
                      {p.planId ?? '—'}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <PositionCloseAction
                        positionId={p.id}
                        instrumentKey={p.instrumentKey}
                        quantity={p.quantity}
                        entityVersion={p.entityVersion}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dashboard.data !== undefined && (
        <section className="rounded-lg border border-border bg-card p-4 space-y-2">
          <h2 className="text-lg font-medium">Dashboard summary</h2>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Incidents open</dt>
              <dd>{dashboard.data.incidentsOpenCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Resolved today</dt>
              <dd>{dashboard.data.incidentsResolvedTodayCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Capital positions</dt>
              <dd>{dashboard.data.capitalPositionsCount}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Total notional USD</dt>
              <dd>{dashboard.data.capitalTotalNotionalUsd}</dd>
            </div>
          </dl>
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h2 className="text-lg font-medium">Execution plans</h2>
        {plans.isLoading && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
        {plans.error !== null && (
          <p className="text-sm text-destructive">
            {plans.error instanceof Error
              ? plans.error.message
              : String(plans.error)}
          </p>
        )}
        {rows.length === 0 && !plans.isLoading && plans.error === null && (
          <p className="text-sm text-muted-foreground">No plans returned.</p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-2 py-1">Plan</th>
                  <th className="px-2 py-1">State</th>
                  <th className="px-2 py-1 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <PlanRow key={String(row.id)} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h2 className="text-lg font-medium">Incident briefs</h2>
        {briefs.data?.items?.length === 0 && (
          <p className="text-sm text-muted-foreground">No briefs.</p>
        )}
        <ul className="list-inside list-disc text-sm space-y-1">
          {(briefs.data?.items ?? []).map((b) => (
            <li key={b.id}>
              <span className="font-mono text-xs">{b.id}</span> — {b.summary}{' '}
              <span className="text-muted-foreground">({b.status})</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h2 className="text-lg font-medium">Recent audit (approvals queue)</h2>
        <p className="text-xs text-muted-foreground">
          Read-only tail of audit entries; not a dedicated approval workflow
          engine.
        </p>
        <ul className="max-h-48 overflow-y-auto text-xs font-mono space-y-1">
          {(approvals.data?.items ?? []).map((a) => (
            <li key={a.id}>
              {a.createdAt} {a.action} by {a.actor}
              {a.resourceId !== undefined && a.resourceId !== null
                ? ` → ${a.resourceId}`
                : ''}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h2 className="text-lg font-medium">Sessions</h2>
        <p className="text-sm text-muted-foreground">{sessions.data?.note}</p>
        <p className="text-xs font-mono">
          Items: {(sessions.data?.items ?? []).length}
        </p>
      </section>
    </main>
  );
}