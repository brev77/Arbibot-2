/** ArbitrageOpportunity lifecycle (Phase 1). */
export const OPPORTUNITY_STATES = {
  detected: 'detected',
  enriched: 'enriched',
  riskChecked: 'risk_checked',
} as const;

export type OpportunityState =
  (typeof OPPORTUNITY_STATES)[keyof typeof OPPORTUNITY_STATES];
