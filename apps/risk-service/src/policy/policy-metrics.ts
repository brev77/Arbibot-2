import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Counter, Histogram } from 'prom-client';

let metrics: {
  readonly watchlistEvaluations: Counter<string>;
  readonly watchlistChanges: Counter<string>;
  readonly routeEvaluations: Counter<string>;
  readonly routeChanges: Counter<string>;
  readonly routeScoreDistribution: Histogram<string>;
} | null = null;

function getOrCreateCounter(reg: ReturnType<typeof getArbibotMetricsRegistry>, name: string, help: string): Counter<string> {
  const existing = reg.getSingleMetric(name) as Counter<string> | undefined;
  if (existing !== undefined) {
    return existing;
  }
  return new Counter({ name, help, registers: [reg] });
}

function getOrCreateHistogram(
  reg: ReturnType<typeof getArbibotMetricsRegistry>,
  name: string,
  help: string,
  buckets: number[],
): Histogram<string> {
  const existing = reg.getSingleMetric(name) as Histogram<string> | undefined;
  if (existing !== undefined) {
    return existing;
  }
  return new Histogram({ name, help, buckets, registers: [reg] });
}

export function getPolicyWriterMetrics(): {
  readonly watchlistEvaluations: Counter<string>;
  readonly watchlistChanges: Counter<string>;
  readonly routeEvaluations: Counter<string>;
  readonly routeChanges: Counter<string>;
  readonly routeScoreDistribution: Histogram<string>;
} {
  if (metrics === null) {
    const reg = getArbibotMetricsRegistry();
    const scoreBuckets = [
      0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1,
    ];
    metrics = {
      watchlistEvaluations: getOrCreateCounter(
        reg,
        'arb_watchlist_tier_evaluations_total',
        'Watchlist tiering writer evaluations (per instrument pass)',
      ),
      watchlistChanges: getOrCreateCounter(
        reg,
        'arb_watchlist_tier_changes_total',
        'Watchlist tier snapshots persisted (tier or reason changed)',
      ),
      routeEvaluations: getOrCreateCounter(
        reg,
        'arb_route_scoring_evaluations_total',
        'Route scoring writer evaluations (per route pass)',
      ),
      routeChanges: getOrCreateCounter(
        reg,
        'arb_route_scoring_changes_total',
        'Route scoring history rows appended',
      ),
      routeScoreDistribution: getOrCreateHistogram(
        reg,
        'arb_route_scoring_score_distribution',
        'Distribution of persisted route scores (0..1)',
        scoreBuckets,
      ),
    };
  }
  return metrics;
}
