/** Server-side service base URLs (override per environment). */
export const apiBases = {
  risk: process.env.RISK_API_BASE ?? 'http://127.0.0.1:3000',
  opportunity: process.env.OPPORTUNITY_API_BASE ?? 'http://127.0.0.1:3010',
  capital: process.env.CAPITAL_API_BASE ?? 'http://127.0.0.1:3011',
  execution: process.env.EXECUTION_API_BASE ?? 'http://127.0.0.1:3012',
  audit: process.env.AUDIT_API_BASE ?? 'http://127.0.0.1:3013',
} as const;
