import Fastify, { type FastifyInstance } from 'fastify';

import { createServiceAuthPreHandler } from './fastify-guard';
import { ARBIBOT_SERVICE_AUTH_HEADER, signServiceRequest } from './signature';

const SECRET = 'a'.repeat(64); // 64 hex chars = 32 bytes entropy minimum

/**
 * Integration tests for the Fastify preHandler that enforces service-to-service
 * HMAC auth (D4-B-6-MTLS acceptance: "a request without auth is rejected").
 *
 * These spin a minimal Fastify instance with only the preHandler registered
 * (no Nest) and use `.inject()` so no real port is opened.
 */
describe('service-auth/fastify-guard (createServiceAuthPreHandler)', () => {
  let app: FastifyInstance;

  async function buildApp(opts?: {
    readonly secret?: string;
    readonly nowSeconds?: () => number;
    readonly maxAgeSeconds?: number;
  }): Promise<FastifyInstance> {
    const instance = Fastify();
    instance.addHook(
      'preHandler',
      createServiceAuthPreHandler({
        secret: opts?.secret ?? SECRET,
        ...(opts?.nowSeconds ? { nowSeconds: opts.nowSeconds } : {}),
        ...(opts?.maxAgeSeconds ? { maxAgeSeconds: opts.maxAgeSeconds } : {}),
      }),
    );
    // A protected route.
    instance.post('/evaluate-risk', async (_req, reply) => {
      await reply.status(200).send({ ok: true });
    });
    // A public-path route (exempt).
    instance.get('/health/live', async (_req, reply) => {
      await reply.status(200).send({ ok: true });
    });
    instance.get('/metrics', async (_req, reply) => {
      await reply.status(200).send('metrics');
    });
    await instance.ready();
    return instance;
  }

  afterEach(async () => {
    if (app !== undefined) {
      await app.close();
    }
  });

  it('rejects an unsigned request to a protected route with 401', async () => {
    app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/evaluate-risk',
      headers: { 'content-type': 'application/json' },
      payload: '{"x":1}',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'ARBIBOT_SERVICE_AUTH_FAILED' });
    expect(res.headers['www-authenticate']).toBe('ArbibotServiceAuth');
  });

  it('accepts a correctly signed request to a protected route', async () => {
    app = await buildApp();
    const body = '{"x":1}';
    const signed = signServiceRequest({
      secret: SECRET,
      method: 'POST',
      pathWithQuery: '/evaluate-risk',
      body,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/evaluate-risk',
      headers: {
        [ARBIBOT_SERVICE_AUTH_HEADER]: signed.value,
        'x-arbibot-body-sha256': signed.bodyHashHex,
        'content-type': 'application/json',
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('exempts public paths (/health/live, /metrics) from auth', async () => {
    app = await buildApp();
    const health = await app.inject({ method: 'GET', url: '/health/live' });
    expect(health.statusCode).toBe(200);

    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.statusCode).toBe(200);
  });

  it('rejects a request whose signature is stale (clock skew > maxAge)', async () => {
    const fixedNow = 1_700_000_000;
    app = await buildApp({ nowSeconds: () => fixedNow, maxAgeSeconds: 5 * 60 });

    // Sign with a timestamp far in the past → stale.
    const signed = signServiceRequest({
      secret: SECRET,
      method: 'POST',
      pathWithQuery: '/evaluate-risk',
      body: '{"x":1}',
      nowSeconds: fixedNow - 10 * 60, // 10 min ago, maxAge is 5 min
    });
    const res = await app.inject({
      method: 'POST',
      url: '/evaluate-risk',
      headers: {
        [ARBIBOT_SERVICE_AUTH_HEADER]: signed.value,
        'x-arbibot-body-sha256': signed.bodyHashHex,
        'content-type': 'application/json',
      },
      payload: '{"x":1}',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      code: 'ARBIBOT_SERVICE_AUTH_FAILED',
      reason: 'stale_timestamp',
    });
  });

  it('rejects a signature made with a different secret (bad_signature)', async () => {
    app = await buildApp();
    const otherSecret = 'b'.repeat(64);
    const signed = signServiceRequest({
      secret: otherSecret,
      method: 'POST',
      pathWithQuery: '/evaluate-risk',
      body: '{"x":1}',
    });
    const res = await app.inject({
      method: 'POST',
      url: '/evaluate-risk',
      headers: {
        [ARBIBOT_SERVICE_AUTH_HEADER]: signed.value,
        'x-arbibot-body-sha256': signed.bodyHashHex,
        'content-type': 'application/json',
      },
      payload: '{"x":1}',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      code: 'ARBIBOT_SERVICE_AUTH_FAILED',
      reason: 'bad_signature',
    });
  });

  it('rejects when the body was tampered after signing (bad_signature)', async () => {
    app = await buildApp();
    const signed = signServiceRequest({
      secret: SECRET,
      method: 'POST',
      pathWithQuery: '/evaluate-risk',
      body: '{"x":1}',
    });
    // Send a DIFFERENT body than the one signed.
    const res = await app.inject({
      method: 'POST',
      url: '/evaluate-risk',
      headers: {
        [ARBIBOT_SERVICE_AUTH_HEADER]: signed.value,
        'x-arbibot-body-sha256': signed.bodyHashHex,
        'content-type': 'application/json',
      },
      payload: '{"x":999}',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: 'ARBIBOT_SERVICE_AUTH_FAILED' });
  });
});
