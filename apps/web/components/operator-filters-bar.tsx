'use client';

import type { ReactNode } from 'react';

import { useOperatorFiltersStore } from '../lib/operator-filters-store';

const stateOptions = [
  { value: '', label: 'All states' },
  { value: 'detected', label: 'detected' },
  { value: 'enriched', label: 'enriched' },
  { value: 'risk_checked', label: 'risk_checked' },
] as const;

export function OperatorFiltersBar(): ReactNode {
  const search = useOperatorFiltersStore((s) => s.opportunitySearch);
  const state = useOperatorFiltersStore((s) => s.opportunityState);
  const setSearch = useOperatorFiltersStore((s) => s.setOpportunitySearch);
  const setState = useOperatorFiltersStore((s) => s.setOpportunityState);

  return (
    <div
      className="operator-toolbar"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem',
        alignItems: 'center',
        padding: '0.5rem 1.5rem',
        borderBottom: '1px solid #1e293b',
        fontSize: 13,
      }}
    >
      <span style={{ color: '#64748b', marginRight: '0.25rem' }}>Filters</span>
      <input
        type="search"
        placeholder="Search opportunities (id / correlation)…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          flex: '1 1 200px',
          minWidth: 180,
          maxWidth: 360,
          padding: '0.35rem 0.5rem',
          borderRadius: 6,
          border: '1px solid #334155',
          background: '#0f172a',
          color: '#e5e7eb',
        }}
      />
      <select
        value={state}
        onChange={(e) => setState(e.target.value)}
        style={{
          padding: '0.35rem 0.5rem',
          borderRadius: 6,
          border: '1px solid #334155',
          background: '#0f172a',
          color: '#e5e7eb',
        }}
        aria-label="Filter by opportunity state"
      >
        {stateOptions.map((o) => (
          <option key={o.value || 'all'} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
