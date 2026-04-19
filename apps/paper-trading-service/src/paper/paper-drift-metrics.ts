import { Counter, Gauge } from 'prom-client';

import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

export const paperDriftSamplesRecorded = new Counter({
  name: 'arb_paper_drift_samples_recorded_total',
  help: 'Paper vs reference mid drift samples persisted (Phase 3 observability).',
  registers: [getArbibotMetricsRegistry()],
});

export const paperDriftBpsCurrent = new Gauge({
  name: 'arb_paper_drift_bps_current',
  help: 'Current drift in basis points for active paper trading instruments.',
  labelNames: ['instrumentKey', 'routeKey'],
  registers: [getArbibotMetricsRegistry()],
});

export const paperDriftBpsStale = new Gauge({
  name: 'arb_paper_drift_bps_stale',
  help: 'Number of instruments with stale drift samples (>30 minutes old).',
  registers: [getArbibotMetricsRegistry()],
});
