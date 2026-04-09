import type { ReactNode } from 'react';

import { apiBases } from '../../lib/api-base';
import { fetchJson, type ListResponse } from '../../lib/server-api';

export default async function DashboardPage(): Promise<ReactNode> {
  const [opps, plans, audit] = await Promise.all([
    fetchJson<ListResponse<unknown>>(`${apiBases.opportunity}/opportunities`, 15),
    fetchJson<ListResponse<unknown>>(`${apiBases.execution}/execution/plans`, 15),
    fetchJson<ListResponse<unknown>>(`${apiBases.audit}/audit/entries?limit=10`, 15),
  ]);

  return (
    <main style={{ padding: '1.5rem 2rem', maxWidth: 1200 }}>
      <h1 style={{ marginTop: 0 }}>Dashboard (M1)</h1>
      <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>
        Read models from backend when services are running; placeholders when
        unreachable.
      </p>
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>Opportunities snapshot</h2>
        <p style={{ color: '#94a3b8' }}>
          Count:{' '}
          {opps?.items !== undefined ? opps.items.length : '— (API down)'}
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
          Entries:{' '}
          {audit?.items !== undefined ? audit.items.length : '— (API down)'}
        </p>
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
