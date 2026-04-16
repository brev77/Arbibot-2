import type { AuditListItem } from './audit-types';
import type { ExecutionPlanListItem } from './execution-types';

/**
 * Timeline for a plan: audit rows tied to the plan id or the same correlation id.
 * Read-only; best-effort against `GET /audit/entries` (bounded limit on caller).
 */
export function buildExecutionPlanTimeline(
  plan: ExecutionPlanListItem,
  auditItems: readonly AuditListItem[],
): AuditListItem[] {
  const correlation = plan.correlationId;
  const filtered = auditItems.filter((e) => {
    if (e.resourceType === 'ExecutionPlan' && e.resourceId === plan.id) {
      return true;
    }
    if (
      correlation !== null &&
      correlation.length > 0 &&
      e.correlationId === correlation
    ) {
      return true;
    }
    return false;
  });
  const seen = new Set<string>();
  const deduped = filtered.filter((e) => {
    if (seen.has(e.id)) {
      return false;
    }
    seen.add(e.id);
    return true;
  });
  return [...deduped].sort(
    (a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}
