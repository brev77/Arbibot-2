import Link from 'next/link';
import type { ReactNode } from 'react';

import { apiBases } from '../../lib/api-base';
import type { AuditListItem } from '../../lib/audit-types';
import type { OpportunityListItem } from '../../lib/opportunity-types';
import { fetchJson, type ListResponse } from '../../lib/server-api';

export default async function DashboardPage(): Promise<ReactNode> {
  const [opps, plans, audit] = await Promise.all([
    fetchJson<ListResponse<OpportunityListItem>>(
      `${apiBases.opportunity}/opportunities`,
      15,
    ),
    fetchJson<ListResponse<unknown>>(`${apiBases.execution}/execution/plans`, 15),
    fetchJson<ListResponse<AuditListItem>>(
      `${apiBases.audit}/audit/entries?limit=12`,
      15,
    ),
  ]);

  const oppItems = opps?.items ?? [];
  const preview = oppItems.slice(0, 6);
  const auditItems = audit?.items ?? [];

  return (
    <main style={{ padding: '1.5rem 2rem', maxWidth: 1200 }}>
      <h1 style={{ marginTop: 0 }}>Dashboard (M1)</h1>
      <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>
        Read models from backend when services are running; placeholders when
        unreachable. Sections follow operator spec §5.1 (M1).
      </p>
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Opportunities snapshot</h2>
        <p style={{ color: '#94a3b8' }}>
          Total loaded:{' '}
          {opps?.items !== undefined ? opps.items.length : '— (API down)'}
        </p>
        {preview.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0 0' }}>
            {preview.map((o) => (
              <li
                key={o.id}
                style={{
                  display: 'flex',
                  gap: '1rem',
                  flexWrap: 'wrap',
                  padding: '0.35rem 0',
                  borderBottom: '1px solid #1e293b',
                  fontSize: 13,
                }}
              >
                <Link href={`/opportunities/${o.id}`} style={{ color: '#38bdf8' }}>
                  {o.id.slice(0, 8)}…
                </Link>
                <span style={{ color: '#94a3b8' }}>{o.state}</span>
                <span style={{ color: '#64748b' }}>
                  v{o.entityVersion}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <p style={{ marginTop: '0.75rem' }}>
          <Link href="/opportunities" style={{ color: '#38bdf8', fontSize: 14 }}>
            Open opportunities workspace →
          </Link>
        </p>
      </section>
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Execution highlights</h2>
        <p style={{ color: '#94a3b8' }}>
          Plans:{' '}
          {plans?.items !== undefined ? plans.items.length : '— (API down)'}
        </p>
      </section>
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Recent audit</h2>
        <p style={{ color: '#94a3b8' }}>
          Entries loaded:{' '}
          {audit?.items !== undefined ? audit.items.length : '— (API down)'}
        </p>
        {auditItems.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0 0' }}>
            {auditItems.slice(0, 8).map((a) => (
              <li
                key={a.id}
                style={{
                  padding: '0.35rem 0',
                  borderBottom: '1px solid #1e293b',
                  fontSize: 13,
                }}
              >
                <span style={{ color: '#e5e7eb' }}>
                  {a.actor}
                </span>
                <span style={{ color: '#64748b', margin: '0 0.5rem' }}>·</span>
                <span style={{ color: '#94a3b8' }}>{a.action}</span>
                {a.resourceId !== null ? (
                  <span style={{ color: '#475569', marginLeft: '0.5rem' }}>
                    {a.resourceType ?? 'resource'} {a.resourceId.slice(0, 8)}…
                  </span>
                ) : null}
                <span style={{ color: '#475569', marginLeft: '0.5rem' }}>
                  {a.createdAt}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Incidents</h2>
        <p style={{ color: '#94a3b8' }}>
          Incident catalog lands in Phase 2; dashboard keeps the slot visible so
          M1 layout matches the operator spec.
        </p>
      </section>
      <section>
        <h2 style={{ fontSize: '1.1rem' }}>Capital / portfolio</h2>
        <p style={{ color: '#94a3b8' }}>
          Portfolio API Phase 2 — placeholder section per spec §5.1.
        </p>
      </section>
    </main>
  );
}
