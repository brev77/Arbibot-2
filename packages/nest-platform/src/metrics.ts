import type { FastifyInstance } from 'fastify';
import {
  Counter,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

const registry = new Registry();
collectDefaultMetrics({ register: registry });

const httpRequests = new Counter({
  name: 'arb_http_requests_total',
  help: 'Total HTTP requests (Arbibot Nest + Fastify)',
  labelNames: ['method', 'route', 'status_code'],
  registers: [registry],
});

/**
 * Registers `GET /metrics` (or `path`) and an `onResponse` hook for request counts.
 * Idempotent per process: safe to call once per Fastify instance.
 */
export function installMetricsOnFastify(
  app: FastifyInstance,
  path = '/metrics',
): void {
  app.addHook('onResponse', (request, reply, done) => {
    const route =
      (request as { routerPath?: string }).routerPath ??
      request.url.split('?')[0] ??
      'unknown';
    httpRequests.inc({
      method: request.method,
      route: String(route).slice(0, 200),
      status_code: String(reply.statusCode),
    });
    done();
  });

  app.get(path, async (_request, reply) => {
    void reply.header('Content-Type', registry.contentType);
    return reply.send(await registry.metrics());
  });
}
