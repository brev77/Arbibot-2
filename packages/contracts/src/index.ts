export * from './events';

/** Service identifiers for gateways and docs (no runtime coupling). */
export const SERVICE_IDS = {
  riskService: 'risk-service',
  opportunityService: 'opportunity-service',
  capitalService: 'capital-service',
  executionOrchestrator: 'execution-orchestrator',
} as const;

/** HTTP routes — mirror OpenAPI paths when added. */
export const RISK_HTTP_ROUTES = {
  evaluateRisk: 'POST /evaluate-risk',
  getRiskDecision: 'GET /risk-decisions/:id',
} as const;

export const OPPORTUNITY_HTTP_ROUTES = {
  list: 'GET /opportunities',
  create: 'POST /opportunities',
  getOne: 'GET /opportunities/:id',
} as const;

export const CAPITAL_HTTP_ROUTES = {
  reserve: 'POST /capital/reservations',
  getReservation: 'GET /capital/reservations/:id',
} as const;

export const EXECUTION_HTTP_ROUTES = {
  createPlan: 'POST /execution/plans',
  listPlans: 'GET /execution/plans',
  getPlan: 'GET /execution/plans/:id',
  linkReservation: 'POST /execution/plans/:id/link-reservation',
  armPlan: 'POST /execution/plans/:id/arm',
} as const;

export const AUDIT_HTTP_ROUTES = {
  append: 'POST /audit/entries',
  list: 'GET /audit/entries',
} as const;
