import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Counter } from 'prom-client';

let counter: Counter<'operation'> | null = null;

/** Increments when Redis read/write for safe mode fails (observability / SRE). */
export function getSafeModeRedisErrorsCounter(): Counter<'operation'> {
  if (counter === null) {
    const reg = getArbibotMetricsRegistry();
    const existing = reg.getSingleMetric(
      'arb_openclaw_safe_mode_redis_errors_total',
    ) as Counter<'operation'> | undefined;
    counter =
      existing ??
      new Counter({
        name: 'arb_openclaw_safe_mode_redis_errors_total',
        help: 'Redis errors in OpenClaw safe mode (get/set/connection)',
        labelNames: ['operation'],
        registers: [reg],
      });
  }
  return counter;
}
