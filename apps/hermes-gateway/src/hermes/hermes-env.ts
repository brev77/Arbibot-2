/** Strip trailing slash from base URL. */
export function normalizeBase(url: string): string {
  return url.replace(/\/$/, '');
}

export function getExecutionApiBase(): string {
  return normalizeBase(
    process.env.EXECUTION_API_BASE ?? 'http://127.0.0.1:3012',
  );
}

export function getPortfolioApiBase(): string {
  return normalizeBase(
    process.env.PORTFOLIO_API_BASE ?? 'http://127.0.0.1:3016',
  );
}

export function getReconciliationApiBase(): string {
  return normalizeBase(
    process.env.RECONCILIATION_API_BASE ?? 'http://127.0.0.1:3017',
  );
}

export function getOperatorWebBffBase(): string {
  return normalizeBase(
    process.env.OPERATOR_WEB_BFF_BASE ?? 'http://127.0.0.1:3000',
  );
}

export function getAuditApiBase(): string {
  return normalizeBase(
    process.env.AUDIT_API_BASE ?? 'http://127.0.0.1:3013',
  );
}

/**
 * config-service base (Plan 6 — Hermes config management).
 * Used by `/hermes/v1/config/*` routes to proxy to `/policy/configurations/*`.
 */
export function getConfigApiBase(): string {
  return normalizeBase(
    process.env.CONFIG_API_BASE ?? 'http://127.0.0.1:3019',
  );
}
