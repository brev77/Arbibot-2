import { signedFetch } from '@arbibot/nest-platform';

/**
 * Read-side helper for `opportunity.filters` from config-service (planned integration).
 *
 * @see ../../../../docs/opportunity-filters-config-keys.md
 */
export const OPPORTUNITY_FILTERS_POLICY_KEY = 'opportunity.filters';

export type OpportunityFiltersPolicy = {
  readonly minSpreadBps?: number;
  readonly maxConcurrentOpportunities?: number;
  readonly blockedVenueIds?: string[];
  readonly blockedRouteKeys?: string[];
  readonly [key: string]: unknown;
};

export async function fetchOpportunityFiltersEffective(
  configServiceBase: string,
  opts?: {
    readonly environment?: string;
    readonly tenantId?: string;
    readonly timeoutMs?: number;
  },
): Promise<OpportunityFiltersPolicy | null> {
  const base = configServiceBase.replace(/\/$/, '');
  const q = new URLSearchParams();
  if (opts?.environment !== undefined && opts.environment.length > 0) {
    q.set('environment', opts.environment);
  }
  if (opts?.tenantId !== undefined && opts.tenantId.length > 0) {
    q.set('tenantId', opts.tenantId);
  }
  const qs = q.toString();
  const url = `${base}/policy/configurations/${encodeURIComponent(OPPORTUNITY_FILTERS_POLICY_KEY)}/effective${qs.length > 0 ? `?${qs}` : ''}`;

  const ac = new AbortController();
  const timeoutMs = opts?.timeoutMs ?? 8000;
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await signedFetch(url, {
      signal: ac.signal,
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      return null;
    }
    const body = (await res.json()) as { configValue?: unknown };
    const raw = body.configValue;
    if (typeof raw !== 'string') {
      return null;
    }
    return JSON.parse(raw) as OpportunityFiltersPolicy;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
