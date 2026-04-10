import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { apiBases } from '../../../lib/api-base';
import type { OpportunityDetail } from '../../../lib/opportunity-types';
import { fetchResource } from '../../../lib/server-api';

export default async function OpportunityDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const result = await fetchResource<OpportunityDetail>(
    `${apiBases.opportunity}/opportunities/${id}`,
    10,
  );
  if (!result.ok) {
    if (result.kind === 'not_found') {
      notFound();
    }
    const detail =
      result.kind === 'upstream'
        ? `Opportunity API returned HTTP ${result.status}`
        : 'Could not reach opportunity service';
    throw new Error(detail);
  }
  const row = result.data;

  return (
    <main style={{ padding: '1.5rem 2rem', maxWidth: 900 }}>
      <h1 style={{ marginTop: 0 }}>Opportunity</h1>
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: '160px 1fr',
          gap: '0.35rem 1rem',
          fontSize: 14,
        }}
      >
        <dt style={{ color: '#64748b' }}>ID</dt>
        <dd style={{ margin: 0 }}>{row.id}</dd>
        <dt style={{ color: '#64748b' }}>State</dt>
        <dd style={{ margin: 0 }}>{row.state}</dd>
        <dt style={{ color: '#64748b' }}>Correlation</dt>
        <dd style={{ margin: 0 }}>{row.correlationId ?? '—'}</dd>
        <dt style={{ color: '#64748b' }}>Risk decision</dt>
        <dd style={{ margin: 0 }}>{row.riskDecisionId ?? '—'}</dd>
        <dt style={{ color: '#64748b' }}>Version</dt>
        <dd style={{ margin: 0 }}>{row.entityVersion}</dd>
        <dt style={{ color: '#64748b' }}>Created</dt>
        <dd style={{ margin: 0 }}>{row.createdAt}</dd>
        <dt style={{ color: '#64748b' }}>Updated</dt>
        <dd style={{ margin: 0 }}>{row.updatedAt}</dd>
      </dl>
      <h2 style={{ fontSize: '1rem', marginTop: '2rem' }}>Payload</h2>
      <pre
        style={{
          background: '#0f172a',
          padding: '1rem',
          borderRadius: 8,
          overflow: 'auto',
          fontSize: 12,
        }}
      >
        {JSON.stringify(row.payload, null, 2)}
      </pre>
    </main>
  );
}
