/**
 * Unified incident model for `/incidents` UI.
 *
 * Drill #1 gap #1: `/incidents` previously only displayed reconciliation
 * mismatches. We now merge them with Alertmanager-driven incidents into a
 * single, source-tagged view. Each variant retains its raw fields for drill-down.
 */
import type { ReconciliationMismatchListItem } from './reconciliation-types';

export type { ReconciliationMismatchListItem } from './reconciliation-types';

export type IncidentSource = 'reconciliation' | 'alertmanager';

export type AlertmanagerIncidentListItem = {
  readonly id: string;
  readonly source: 'alertmanager';
  readonly alertName: string;
  readonly severity: 'critical' | 'warning' | 'info';
  readonly status: string;
  readonly fingerprint: string;
  readonly entityVersion: number;
  readonly summary: string | null;
  readonly description: string | null;
  readonly payload: Record<string, unknown>;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly lastFiredAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly resolvedAt: string | null;
  readonly resolvedBy: string | null;
};

/**
 * Normalized shape used inside `IncidentsWorkspace` after merging the two
 * sources. Keeps a stable `id`, `source`, severity, status, title and a
 * timestamp for ordering + filtering.
 */
export type UnifiedIncidentItem = {
  readonly id: string;
  readonly source: IncidentSource;
  readonly severity: 'critical' | 'warning' | 'info' | 'unknown';
  readonly status: string;
  readonly title: string;
  readonly description: string;
  readonly entityVersion: number;
  readonly createdAt: string;
  /** Optional plan link for reconciliation rows. */
  readonly planId: string | null;
  /** Optional Alertmanager fingerprint for dedup display. */
  readonly fingerprint: string | null;
  /** Last activity timestamp (updatedAt for reconciliation, lastFiredAt for alerts). */
  readonly lastActivityAt: string;
  /** Raw row preserved for drill-down / mutations. */
  readonly raw:
    | { readonly kind: 'reconciliation'; readonly row: ReconciliationMismatchListItem }
    | { readonly kind: 'alertmanager'; readonly row: AlertmanagerIncidentListItem };
};