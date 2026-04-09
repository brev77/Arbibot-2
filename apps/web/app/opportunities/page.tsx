import type { ReactNode } from 'react';

import { apiBases } from '../../lib/api-base';
import { fetchJson, type ListResponse } from '../../lib/server-api';

export default async function OpportunitiesPage(): Promise<ReactNode> {
  const body = await fetchJson<ListResponse<unknown>>(
    `${apiBases.opportunity}/opportunities`,
    10,
  );

  return (
    <main style={{ padding: '1.5rem 2rem' }}>
      <h1>Opportunities</h1>
      {body !== null ? (
        <p style={{ color: '#94a3b8' }}>{body.items.length} loaded.</p>
      ) : (
        <p style={{ color: '#94a3b8' }}>
          Opportunity service unavailable — start `@arbibot/opportunity-service`
          with DATABASE_URL.
        </p>
      )}
    </main>
  );
}
