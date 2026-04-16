import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { apiBases } from '../../../../lib/api-base';
import type { AuditListItem } from '../../../../lib/audit-types';
import { buildExecutionPlanTimeline } from '../../../../lib/execution-timeline';
import type { ExecutionPlanListItem } from '../../../../lib/execution-types';
import { fetchJson, fetchResource, type ListResponse } from '../../../../lib/server-api';

export default async function ExecutionPlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const result = await fetchResource<ExecutionPlanListItem>(
    `${apiBases.execution}/execution/plans/${id}`,
    10,
  );
  if (!result.ok) {
    if (result.kind === 'not_found') {
      notFound();
    }
    const detail =
      result.kind === 'upstream'
        ? `Execution API returned HTTP ${result.status}`
        : 'Could not reach execution orchestrator';
    throw new Error(detail);
  }
  const plan = result.data;

  const auditBody = await fetchJson<ListResponse<AuditListItem>>(
    `${apiBases.audit}/audit/entries?limit=200`,
    10,
  );
  const auditItems = auditBody?.items ?? [];
  const timeline = buildExecutionPlanTimeline(plan, auditItems);

  return (
    <main style={{ padding: '1.5rem 2rem', maxWidth: 960 }}>
      <p style={{ marginTop: 0 }}>
        <Link href="/execution" style={{ color: '#38bdf8', fontSize: 14 }}>
          ← Execution plans
        </Link>
      </p>
      <h1 style={{ marginTop: '0.25rem' }}>Execution plan</h1>
      <p style={{ color: '#94a3b8', fontSize: 14 }}>
        Read-only detail (P2-2.3-EXECUI). Timeline merges audit rows for this plan
        and for matching <code>correlationId</code> (bounded to last 200 audit
        entries).
      </p>

      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: '180px 1fr',
          gap: '0.35rem 1rem',
          fontSize: 14,
          marginTop: '1.5rem',
        }}
      >
        <dt style={{ color: '#64748b' }}>ID</dt>
        <dd style={{ margin: 0, wordBreak: 'break-all' }}>{plan.id}</dd>
        <dt style={{ color: '#64748b' }}>State</dt>
        <dd style={{ margin: 0 }}>{plan.state}</dd>
        <dt style={{ color: '#64748b' }}>Correlation</dt>
        <dd style={{ margin: 0 }}>{plan.correlationId ?? '—'}</dd>
        <dt style={{ color: '#64748b' }}>Capital reservation</dt>
        <dd style={{ margin: 0 }}>{plan.capitalReservationId ?? '—'}</dd>
        <dt style={{ color: '#64748b' }}>Risk decision</dt>
        <dd style={{ margin: 0 }}>{plan.riskDecisionId ?? '—'}</dd>
        <dt style={{ color: '#64748b' }}>Version</dt>
        <dd style={{ margin: 0 }}>{plan.entityVersion}</dd>
        <dt style={{ color: '#64748b' }}>Created</dt>
        <dd style={{ margin: 0 }}>{plan.createdAt}</dd>
        <dt style={{ color: '#64748b' }}>Updated</dt>
        <dd style={{ margin: 0 }}>{plan.updatedAt}</dd>
      </dl>

      <section style={{ marginTop: '2.5rem' }}>
        <h2 style={{ fontSize: '1.05rem' }}>Timeline</h2>
        {auditBody === null ? (
          <p style={{ color: '#94a3b8' }}>
            Audit service unavailable — timeline needs{' '}
            <code>GET /audit/entries</code>.
          </p>
        ) : timeline.length === 0 ? (
          <p style={{ color: '#94a3b8' }}>
            No audit rows matched this plan in the recent window. After
            LinkReservation / ArmPlan, entries with{' '}
            <code>resourceType=ExecutionPlan</code> should appear.
          </p>
        ) : (
          <ol
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '1rem 0 0',
              borderLeft: '2px solid #334155',
            }}
          >
            {timeline.map((e) => (
              <li
                key={e.id}
                style={{
                  position: 'relative',
                  padding: '0.5rem 0 0.5rem 1.25rem',
                  fontSize: 13,
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    left: -5,
                    top: '0.65rem',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#38bdf8',
                  }}
                />
                <div style={{ color: '#e2e8f0' }}>
                  <strong>{e.action}</strong>{' '}
                  <span style={{ color: '#64748b' }}>{e.actor}</span>
                </div>
                <div style={{ color: '#64748b', fontSize: 12 }}>
                  {e.createdAt}
                  {e.resourceType !== null ? ` · ${e.resourceType}` : ''}
                  {e.correlationId !== null ? ` · corr ${e.correlationId.slice(0, 8)}…` : ''}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section
        style={{
          marginTop: '2.5rem',
          padding: '1rem 1.25rem',
          borderRadius: 8,
          border: '1px dashed #475569',
          background: '#0f172a',
        }}
      >
        <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>Operator actions</h2>
        <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: '1rem' }}>
          Destructive controls (force hedge, force unwind, cancel in flight) require
          impact preview, two-step approval, and audit (§5.4). Backend endpoints are
          not wired in this slice — controls stay disabled.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
          <button type="button" disabled>
            Force hedge (preview)
          </button>
          <button type="button" disabled>
            Force unwind (preview)
          </button>
          <button type="button" disabled>
            Cancel plan (preview)
          </button>
        </div>
      </section>
    </main>
  );
}
