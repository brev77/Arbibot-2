import type { ReactNode } from 'react';

import { OpportunitiesTable } from '../../components/opportunities-table';
import { apiBases } from '../../lib/api-base';
import type { OpportunityListItem } from '../../lib/opportunity-types';
import { fetchJson, type ListResponse } from '../../lib/server-api';

export default async function OpportunitiesPage(): Promise<ReactNode> {
  const body = await fetchJson<ListResponse<OpportunityListItem>>(
    `${apiBases.opportunity}/opportunities`,
    10,
  );

  return (
    <main style={{ padding: '1.5rem 2rem', maxWidth: 1200 }}>
      <h1 style={{ marginTop: 0 }}>Opportunities</h1>
      <p style={{ color: '#94a3b8', marginBottom: '1rem' }}>
        Use the toolbar filters to search by id / correlation / risk decision id
        or narrow by lifecycle state. Table uses TanStack Table (read-only).
      </p>
      {body !== null ? (
        <OpportunitiesTable items={body.items} />
      ) : (
        <p style={{ color: '#94a3b8' }}>
          Opportunity service unavailable — start `@arbibot/opportunity-service`
          with DATABASE_URL.
        </p>
      )}
    </main>
  );
}
