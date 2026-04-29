/** Server-side service base URLs (override per environment). */
export const apiBases = {
  risk: process.env.RISK_API_BASE ?? 'http://127.0.0.1:3000',
  opportunity: process.env.OPPORTUNITY_API_BASE ?? 'http://127.0.0.1:3010',
  capital: process.env.CAPITAL_API_BASE ?? 'http://127.0.0.1:3011',
  execution: process.env.EXECUTION_API_BASE ?? 'http://127.0.0.1:3012',
  audit: process.env.AUDIT_API_BASE ?? 'http://127.0.0.1:3013',
  portfolio: process.env.PORTFOLIO_API_BASE ?? 'http://127.0.0.1:3016',
  reconciliation: process.env.RECONCILIATION_API_BASE ?? 'http://127.0.0.1:3017',
  paper: process.env.PAPER_API_BASE ?? 'http://127.0.0.1:3018',
  config: process.env.CONFIG_API_BASE ?? 'http://127.0.0.1:3019',
  /** market-intake-service (snapshots, Phase 4 degradation signals). */
  marketIntake: process.env.MARKET_INTAKE_API_BASE ?? 'http://127.0.0.1:3015',
} as const;

/** Alias for BFF routes targeting `config-service`. */
export const CONFIG_API_BASE = apiBases.config;

/** Alias for BFF routes targeting `opportunity-service`. */
export const OPPORTUNITY_API_BASE = apiBases.opportunity;
