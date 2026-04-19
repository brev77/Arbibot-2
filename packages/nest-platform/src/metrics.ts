import type { FastifyInstance } from 'fastify';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

const registry = new Registry();
collectDefaultMetrics({ register: registry });

const LATENCY_BUCKETS = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5];

const REQUEST_START = Symbol('arbibotHttpRequestStartNs');

/** Standard Prometheus name; aligns with Grafana `http_request_duration_seconds_*`. */
const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds (Arbibot Nest + Fastify)',
  labelNames: ['method', 'route', 'status_code', 'service'],
  buckets: LATENCY_BUCKETS,
  registers: [registry],
});

const httpRequests = new Counter({
  name: 'arb_http_requests_total',
  help: 'Total HTTP requests (Arbibot Nest + Fastify)',
  labelNames: ['method', 'route', 'status_code', 'service'],
  registers: [registry],
});

export interface InstallMetricsOptions {
  /** Path for the Prometheus scrape endpoint (default `/metrics`). */
  path?: string;
  /** Value for the `service` label; falls back to `METRICS_SERVICE_NAME` or `OTEL_SERVICE_NAME`. */
  serviceName?: string;
}

/** Same registry as `GET /metrics` — use for app-specific counters/histograms. */
export function getArbibotMetricsRegistry(): Registry {
  return registry;
}

function resolveServiceLabel(options: InstallMetricsOptions): string {
  const fromOpt = options.serviceName?.trim();
  if (fromOpt && fromOpt.length > 0) {
    return fromOpt;
  }
  const fromEnv =
    process.env.METRICS_SERVICE_NAME?.trim() ||
    process.env.OTEL_SERVICE_NAME?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  return 'unknown';
}

/**
 * Registers `GET /metrics` (or `path`), request counter, and latency histogram.
 * Idempotent per process: safe to call once per Fastify instance.
 */
export function installMetricsOnFastify(
  app: FastifyInstance,
  options: InstallMetricsOptions = {},
): void {
  const path = options.path ?? '/metrics';
  const serviceLabel = resolveServiceLabel(options);

  app.addHook('onRequest', (request, _reply, done) => {
    (request as { [REQUEST_START]?: bigint })[REQUEST_START] = process.hrtime.bigint();
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    const start = (request as { [REQUEST_START]?: bigint })[REQUEST_START];
    let durationSeconds = 0;
    if (start !== undefined) {
      durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    }
    const route =
      (request as { routerPath?: string }).routerPath ??
      request.url.split('?')[0] ??
      'unknown';
    const labels = {
      method: request.method,
      route: String(route).slice(0, 200),
      status_code: String(reply.statusCode),
      service: serviceLabel,
    };
    httpRequests.inc(labels);
    httpRequestDuration.observe(labels, durationSeconds);
    done();
  });

  app.get(path, async (_request, reply) => {
    reply.header('Content-Type', registry.contentType);
    return reply.send(await registry.metrics());
  });
}

export function getHistogramBuckets(): number[] {
  return [...LATENCY_BUCKETS];
}

export function getHttpRequestHistogram(): Histogram<string> {
  return httpRequestDuration;
}
