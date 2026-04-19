/** Centralized query keys for operator dashboard (avoid string drift). */
export const operatorKeys = {
  opportunities: ['operator', 'opportunities'] as const,
  executionPlans: ['operator', 'execution', 'plans'] as const,
  executionPlan: (id: string) => ['operator', 'execution', 'plan', id] as const,
  auditEntries: (limit: number) => ['operator', 'audit', 'entries', limit] as const,
  reconciliationMismatches: ['operator', 'reconciliation', 'mismatches'] as const,
  portfolioPositions: ['operator', 'portfolio', 'positions'] as const,
  dashboardSummary: ['operator', 'dashboard', 'summary'] as const,
  paperTrades: ['operator', 'paper', 'trades'] as const,
  paperPromotionCandidates: ['operator', 'paper', 'promotion-candidates'] as const,
  paperDriftSamples: (instrumentKey: string | undefined, limit: number) =>
    ['operator', 'paper', 'drift-samples', instrumentKey ?? 'all', limit] as const,
};
