/** Centralized query keys for operator dashboard (avoid string drift). */
export const operatorKeys = {
  opportunities: ['operator', 'opportunities'] as const,
  executionPlans: ['operator', 'execution', 'plans'] as const,
  executionPlan: (id: string) => ['operator', 'execution', 'plan', id] as const,
  auditEntries: (limit: number) => ['operator', 'audit', 'entries', limit] as const,
  reconciliationMismatches: ['operator', 'reconciliation', 'mismatches'] as const,
  portfolioPositions: ['operator', 'portfolio', 'positions'] as const,
  dashboardSummary: ['operator', 'dashboard', 'summary'] as const,
  intakeDegradation: ['operator', 'health', 'intake-degradation'] as const,
  paperTrades: ['operator', 'paper', 'trades'] as const,
  paperPromotionCandidates: ['operator', 'paper', 'promotion-candidates'] as const,
  paperDriftSamples: (instrumentKey: string | undefined, limit: number) =>
    ['operator', 'paper', 'drift-samples', instrumentKey ?? 'all', limit] as const,

  openclawPlans: (limit: number) =>
    ['operator', 'openclaw', 'plans', limit] as const,
  openclawDashboard: ['operator', 'openclaw', 'dashboard'] as const,
  openclawIncidentBriefs: ['operator', 'openclaw', 'incident-briefs'] as const,
  openclawApprovalsQueue: (limit: number) =>
    ['operator', 'openclaw', 'approvals-queue', limit] as const,
  openclawSafeMode: ['operator', 'openclaw', 'safe-mode'] as const,
  openclawSessions: ['operator', 'openclaw', 'sessions'] as const,
  openclawPositions: ['operator', 'openclaw', 'positions'] as const,
};
