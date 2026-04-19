import { Counter } from 'prom-client';

import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

export const paperDriftSamplesRecorded = new Counter({
  name: 'arb_paper_drift_samples_recorded_total',
  help: 'Paper vs reference mid drift samples persisted (Phase 3 observability).',
  registers: [getArbibotMetricsRegistry()],
});
