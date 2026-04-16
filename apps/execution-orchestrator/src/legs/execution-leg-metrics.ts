import { Counter } from 'prom-client';

import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

/** apply-fill commits that leave the leg in `partiallyFilled` (playbook / settlement observability). */
export const executionLegPartialFillCommits = new Counter({
  name: 'arb_execution_leg_partial_fill_commits_total',
  help: 'Leg apply-fill commits resulting in partiallyFilled state',
  registers: [getArbibotMetricsRegistry()],
});
