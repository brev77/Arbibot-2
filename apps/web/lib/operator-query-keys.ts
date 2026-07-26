/** Centralized query keys for operator dashboard (avoid string drift). */
export const operatorKeys = {
  opportunities: ['operator', 'opportunities'] as const,
  executionPlans: ['operator', 'execution', 'plans'] as const,
  executionPlan: (id: string) => ['operator', 'execution', 'plan', id] as const,
  auditEntries: (limit: number) => ['operator', 'audit', 'entries', limit] as const,
  reconciliationMismatches: ['operator', 'reconciliation', 'mismatches'] as const,
  /** Alertmanager-driven incidents (Drill #1 gap #1). */
  alertIncidents: ['operator', 'alerts', 'incidents'] as const,
  portfolioPositions: ['operator', 'portfolio', 'positions'] as const,
  dashboardSummary: ['operator', 'dashboard', 'summary'] as const,
  intakeDegradation: ['operator', 'health', 'intake-degradation'] as const,
  paperTrades: ['operator', 'paper', 'trades'] as const,
  paperPromotionCandidates: ['operator', 'paper', 'promotion-candidates'] as const,
  paperDriftSamples: (instrumentKey: string | undefined, limit: number) =>
    ['operator', 'paper', 'drift-samples', instrumentKey ?? 'all', limit] as const,
  // PAD-6: settled-trade history + aggregate stats for the /paper history view.
  paperTradesHistory: (from?: string, to?: string) =>
    ['operator', 'paper', 'trades', 'history', from ?? '', to ?? ''] as const,
  paperTradesStats: (from?: string, to?: string) =>
    ['operator', 'paper', 'trades', 'stats', from ?? '', to ?? ''] as const,

  hermesPlans: (limit: number) =>
    ['operator', 'hermes', 'plans', limit] as const,
  hermesDashboard: ['operator', 'hermes', 'dashboard'] as const,
  hermesIncidentBriefs: ['operator', 'hermes', 'incident-briefs'] as const,
  hermesApprovalsQueue: (limit: number) =>
    ['operator', 'hermes', 'approvals-queue', limit] as const,
  hermesSafeMode: ['operator', 'hermes', 'safe-mode'] as const,
  hermesSessions: ['operator', 'hermes', 'sessions'] as const,
  hermesPositions: ['operator', 'hermes', 'positions'] as const,

  /* DEX-related keys */
  executionPlanDetail: (id: string) => ['operator', 'execution', 'plans', id] as const,
  executionPlanLegs: (planId: string) => ['operator', 'execution', 'plans', planId, 'legs'] as const,
  executionPlanOnChainTxs: (planId: string) => ['operator', 'execution', 'plans', planId, 'on-chain-txs'] as const,
  dexDashboardStats: () => ['operator', 'dashboard', 'dex-stats'] as const,
  dexLimits: () => ['operator', 'settings', 'dex', 'limits'] as const,
  dexLive: () => ['operator', 'settings', 'dex', 'live'] as const,

  /* Scanner-service (cross-DEX spread detector) */
  scannerInstances: ['operator', 'scanners', 'instances'] as const,
  scannerInstance: (id: string) => ['operator', 'scanners', 'instances', id] as const,
  scannerFindings: (instanceId?: string, publishStatus?: string) =>
    [
      'operator',
      'scanners',
      'findings',
      instanceId ?? 'all',
      publishStatus ?? 'all',
    ] as const,
  scannerFinding: (id: string) => ['operator', 'scanners', 'findings', id] as const,
  scannerStatus: ['operator', 'scanners', 'status'] as const,
};
