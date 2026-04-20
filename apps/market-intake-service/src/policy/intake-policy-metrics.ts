import { Counter } from 'prom-client';

import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

const registry = getArbibotMetricsRegistry();

/** Policy cache refresh outcomes (intake reads config/risk). */
export const intakePolicyCacheHits = new Counter({
  name: 'arb_intake_policy_cache_hit_total',
  help: 'Intake policy bundle refresh served from in-memory cache',
  labelNames: ['layer'],
  registers: [registry],
});

export const intakePolicyCacheMisses = new Counter({
  name: 'arb_intake_policy_cache_miss_total',
  help: 'Intake policy bundle refresh required upstream fetch',
  labelNames: ['layer'],
  registers: [registry],
});

export const intakePolicyFallbackTotal = new Counter({
  name: 'arb_intake_policy_fallback_total',
  help: 'Intake policy upstream read failed; degraded to baseline',
  registers: [registry],
});

export const intakeThrottledSnapshotsTotal = new Counter({
  name: 'arb_intake_throttled_snapshots_total',
  help: 'Market snapshot ingest skipped by throttling (no DB write)',
  labelNames: ['reason'],
  registers: [registry],
});

export const intakeRoutingTierTotal = new Counter({
  name: 'arb_intake_routing_count',
  help: 'Ingest evaluations by resolved routing tier',
  labelNames: ['tier'],
  registers: [registry],
});
