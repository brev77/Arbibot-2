export * from './events';

/** Service identifiers for gateways and docs (no runtime coupling). */
export const SERVICE_IDS = {
  riskService: 'risk-service',
  opportunityService: 'opportunity-service',
  capitalService: 'capital-service',
  executionOrchestrator: 'execution-orchestrator',
  canonicalMarketService: 'canonical-market-service',
  marketIntakeService: 'market-intake-service',
  portfolioService: 'portfolio-service',
  reconciliationService: 'reconciliation-service',
} as const;

/** HTTP routes — mirror OpenAPI paths when added. */
export const RISK_HTTP_ROUTES = {
  evaluateRisk: 'POST /evaluate-risk',
  getRiskDecision: 'GET /risk-decisions/:id',
  policyPhase2Readiness: 'GET /policy/phase2-readiness',
  listTokenProfiles: 'GET /policy/token-profiles',
  listRouteProfiles: 'GET /policy/route-profiles',
} as const;

export const OPPORTUNITY_HTTP_ROUTES = {
  list: 'GET /opportunities',
  create: 'POST /opportunities',
  getOne: 'GET /opportunities/:id',
  enrich: 'POST /opportunities/:id/enrich',
  requestRiskEvaluation: 'POST /opportunities/:id/request-risk-evaluation',
} as const;

export const CAPITAL_HTTP_ROUTES = {
  reserve: 'POST /capital/reservations',
  getReservation: 'GET /capital/reservations/:id',
  releaseReservation: 'POST /capital/reservations/:id/release',
} as const;

export const EXECUTION_HTTP_ROUTES = {
  createPlan: 'POST /execution/plans',
  listPlans: 'GET /execution/plans',
  getPlan: 'GET /execution/plans/:id',
  linkReservation: 'POST /execution/plans/:id/link-reservation',
  armPlan: 'POST /execution/plans/:id/arm',
  beginExecution: 'POST /execution/plans/:planId/begin-execution',
  listLegs: 'GET /execution/plans/:planId/legs',
  markLegSent: 'POST /execution/plans/:planId/legs/:legId/mark-sent',
  markLegAcknowledged:
    'POST /execution/plans/:planId/legs/:legId/mark-acknowledged',
  applyLegFill: 'POST /execution/plans/:planId/legs/:legId/apply-fill',
} as const;

export const PORTFOLIO_HTTP_ROUTES = {
  listPositions: 'GET /positions',
  confirmFill: 'POST /positions/confirm-fill',
} as const;

export const RECONCILIATION_HTTP_ROUTES = {
  listMismatches: 'GET /mismatches',
  runDetectors: 'POST /mismatches/run-detectors',
  patchMismatchStatus: 'PATCH /mismatches/:id',
} as const;

export const AUDIT_HTTP_ROUTES = {
  append: 'POST /audit/entries',
  list: 'GET /audit/entries',
} as const;

export const CANONICAL_HTTP_ROUTES = {
  resolveInstrument: 'POST /market/resolve-instrument',
  resolveRoute: 'POST /market/resolve-route',
} as const;

export const INTAKE_HTTP_ROUTES = {
  ingestSnapshot: 'POST /snapshots/ingest',
  getSnapshot: 'GET /snapshots',
} as const;
