/** Service identifiers for gateways and docs (no runtime coupling). */
export const SERVICE_IDS = {
  riskService: 'risk-service',
} as const;

/** HTTP routes — mirror OpenAPI paths when added. */
export const RISK_HTTP_ROUTES = {
  evaluateRisk: 'POST /evaluate-risk',
  getRiskDecision: 'GET /risk-decisions/:id',
} as const;
