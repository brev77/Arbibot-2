import type { FastifyInstance } from 'fastify';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

const registry = new Registry();
collectDefaultMetrics({ register: registry });

// Histogram buckets for latency (1ms to 5s)
const LATENCY_BUCKETS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5];

// HTTP request latency histogram (PRIO-P1-ALERT)
const httpRequestDuration = new Histogram({
  name: 'arb_http_request_duration_seconds',
  help: 'HTTP request duration in seconds (Arbibot Nest + Fastify)',
  labelNames: ['method', 'route', 'status_code'],
  buckets: LATENCY_BUCKETS,
  registers: [registry],
});

// HTTP requests counter (existing)
const httpRequests = new Counter({
  name: 'arb_http_requests_total',
  help: 'Total HTTP requests (Arbibot Nest + Fastify)',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

/** Same registry as `GET /metrics` — use for app-specific counters/histograms. */
export function getArbibotMetricsRegistry(): Registry {
  return registry;
}

/**
 * Middleware for HTTP request latency tracking.
 * Records request duration in histogram for SLO compliance.
 */
export interface MetricsMiddlewareOptions {
  /** Custom buckets for this service (overrides default LATENCY_BUCKETS) */
  buckets?: number[];
  /** Skip specific routes from latency tracking */
  skipRoutes?: string[];
  /** Only track specific routes (if set, others are skipped) */
  onlyRoutes?: string[];
}

export function createMetricsMiddleware(options: MetricsMiddlewareOptions = {}) {
  const {
    buckets = LATENCY_BUCKETS,
    skipRoutes = [],
    onlyRoutes,
  } = options;

  // Create service-specific histogram if custom buckets provided
  let serviceHistogram = httpRequestDuration;
  if (buckets !== LATENCY_BUCKETS) {
    serviceHistogram = new Histogram({
      name: 'arb_http_request_duration_seconds',
      help: 'HTTP request duration in seconds (Arbibot Nest + Fastify)',
      labelNames: ['method', 'route', 'status_code'],
      buckets,
      registers: [registry],
    });
  }

  return async function metricsMiddleware(
    request: any,
    reply: any,
    done: () => void,
  ) {
    const startTime = Date.now();

    // Get route (similar to installMetricsOnFastify)
    const route =
      (request as { routerPath?: string }).routerPath ??
        request.url.split('?')[0] ?? 'unknown';

    // Check if route should be tracked
    const shouldSkip =
      skipRoutes.some((pattern) => route.includes(pattern)) ||
      (onlyRoutes && !onlyRoutes.some((pattern) => route.includes(pattern)));

    // Override done to record latency
    const originalDone = done;
    const wrappedDone = () => {
      const durationMs = Date.now() - startTime;
      const durationSeconds = durationMs / 1000;

      if (!shouldSkip) {
        // Record latency in histogram
        serviceHistogram.observe(
          {
            method: request.method,
            route: String(route).slice(0, 200),
            status_code: String(reply.statusCode),
          },
          durationSeconds,
        );
      }

      // Call original done
      originalDone();
    };

    return wrappedDone;
  };
}

/**
 *
 * Registers `GET /metrics` (or `path`) and an `onResponse` hook for request counts and latency.
 * Idempotent per process: safe to call once per Fastify instance.
 */
export function installMetricsOnFastify(
  app: FastifyInstance,
  path = '/metrics',
): void {
  app.addHook('onResponse', async (request, reply) => {
    const route =
      (request as { routerPath?: string }).routerPath ??
        request.url.split('?')[0] ?? 'unknown';

    // Increment request counter (existing)
    httpRequests.inc({
      method: request.method,
      route: String(route).slice(0, 200),
      status_code: String(reply.statusCode),
    });

    // Request duration is already recorded by middleware
    // No need to duplicate here
  });

  app.get(path, async (_request, reply) => {
    reply.header('Content-Type', registry.contentType);
    return reply.send(await registry.metrics());
  });
}

/**
 * Service-specific latency override options for critical paths (PRIO-P1-ALERT).
 * Tier 1 services: opportunity, risk, orchestrator
 */
export const CRITICAL_SERVICE_OPTIONS: MetricsMiddlewareOptions = {
  buckets: [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1], // More granular for Tier 1
  onlyRoutes: ['/api/'], // Track all API routes
};

/**
 * Service-specific latency override options for standard services.
 * Tier 2 services: capital, portfolio, reconciliation, etc.
 */
export const STANDARD_SERVICE_OPTIONS: MetricsMiddlewareOptions = {
  buckets: LATENCY_BUCKETS, // Default buckets
  onlyRoutes: ['/api/'],
};

/**
 * Export histogram for use in alert queries (PRIO-P1-ALERT).
 * Example: `histogram_quantile(0.99, rate(arb_http_request_duration_seconds_bucket[5m]))`
 */
export function getHistogramBuckets(): number[] {
  return LATENCY_BUCKETS;
}

/**
 * Export histogram instance for direct observation in tests/custom logic.
 */
export function getHttpRequestHistogram(): Histogram<string> {
  return httpRequestDuration;
}
