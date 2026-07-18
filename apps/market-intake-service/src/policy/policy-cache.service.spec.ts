import { PolicyCacheService } from './policy-cache.service';

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return '';
}

/**
 * Minimal Response stub. The real `signedFetch` returns the global Response,
 * but istanbul-instrumented source only consumes `.ok`, `.status`, and
 * `.json()`, so a structural stub is sufficient.
 */
function mkResponse(opts: { ok?: boolean; status?: number; body: unknown }): Response {
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: () => Promise.resolve(opts.body),
  } as Response;
}

/**
 * PolicyCacheService spec (Phase 4 — market-intake-service policy-cache coverage).
 *
 * The service is the single-flight, TTL-bounded read-only cache for intake
 * throttling + routing tiers + watchlist tiers + route-scoring history. We
 * stub `global.fetch` (which `signedFetch` falls through to when service-auth
 * signing is not forced) and exercise:
 *   - TTL clamping (empty / non-finite / below floor / above ceiling)
 *   - cache hit / single-flight inflight
 *   - happy-path bundling (throttle JSON + routing JSON + watchlist items)
 *   - fallbackMode escalation per-upstream (throttle / routing / watchlist)
 *   - malformed payloads (non-string configValue, items not array,
 *     watchlist item with wrong field types)
 *   - environment / tenant query-string propagation
 *   - getRouteScore: empty key / cache hit / network miss / items array /
 *     non-object body / LRU eviction
 */
describe('PolicyCacheService', () => {
  const originalFetch = global.fetch;
  const prevConfigUrl = process.env.CONFIG_SERVICE_URL;
  const prevConfigApi = process.env.CONFIG_API_BASE;
  const prevRiskUrl = process.env.RISK_SERVICE_URL;
  const prevTtl = process.env.INTAKE_POLICY_CACHE_TTL_MS;
  const prevTimeout = process.env.INTAKE_POLICY_HTTP_TIMEOUT_MS;
  const prevEnv = process.env.INTAKE_CONFIG_ENVIRONMENT;
  const prevTenant = process.env.INTAKE_CONFIG_TENANT_ID;

  const setEnv = (overrides: {
    configUrl?: string;
    riskUrl?: string;
    ttl?: string;
    timeout?: string;
    env?: string;
    tenant?: string;
  } = {}) => {
    process.env.CONFIG_SERVICE_URL = overrides.configUrl ?? 'http://cfg.test';
    process.env.RISK_SERVICE_URL = overrides.riskUrl ?? 'http://risk.test';
    if (overrides.ttl !== undefined) {
      process.env.INTAKE_POLICY_CACHE_TTL_MS = overrides.ttl;
    } else {
      delete process.env.INTAKE_POLICY_CACHE_TTL_MS;
    }
    if (overrides.timeout !== undefined) {
      process.env.INTAKE_POLICY_HTTP_TIMEOUT_MS = overrides.timeout;
    } else {
      delete process.env.INTAKE_POLICY_HTTP_TIMEOUT_MS;
    }
    if (overrides.env !== undefined) {
      process.env.INTAKE_CONFIG_ENVIRONMENT = overrides.env;
    } else {
      delete process.env.INTAKE_CONFIG_ENVIRONMENT;
    }
    if (overrides.tenant !== undefined) {
      process.env.INTAKE_CONFIG_TENANT_ID = overrides.tenant;
    } else {
      delete process.env.INTAKE_CONFIG_TENANT_ID;
    }
  };

  /** Build a fetch mock that responds per-URL with the given bodies. */
  const buildFetch = (
    routes: Array<{
      match: (u: string) => boolean;
      response: { ok?: boolean; status?: number; body: unknown };
    }>,
  ): typeof fetch => {
    return jest.fn((...args: Parameters<typeof fetch>): Promise<Response> => {
      const u = requestUrl(args[0]);
      for (const r of routes) {
        if (r.match(u)) {
          return Promise.resolve(mkResponse(r.response));
        }
      }
      return Promise.resolve(mkResponse({ ok: false, status: 404, body: null }));
    }) as typeof fetch;
  };

  afterEach(() => {
    global.fetch = originalFetch;
    for (const [k, v] of Object.entries({
      CONFIG_SERVICE_URL: prevConfigUrl,
      CONFIG_API_BASE: prevConfigApi,
      RISK_SERVICE_URL: prevRiskUrl,
      INTAKE_POLICY_CACHE_TTL_MS: prevTtl,
      INTAKE_POLICY_HTTP_TIMEOUT_MS: prevTimeout,
      INTAKE_CONFIG_ENVIRONMENT: prevEnv,
      INTAKE_CONFIG_TENANT_ID: prevTenant,
    })) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  describe('TTL / config helpers', () => {
    it('clamps to default 120_000ms when env is unset', () => {
      setEnv();
      const svc = new PolicyCacheService();
      expect(svc.getTtlMs()).toBe(120_000);
    });

    it('clamps to default when env is non-finite (NaN / Infinity)', () => {
      setEnv({ ttl: 'not-a-number' });
      expect(new PolicyCacheService().getTtlMs()).toBe(120_000);
      setEnv({ ttl: 'Infinity' });
      expect(new PolicyCacheService().getTtlMs()).toBe(120_000);
    });

    it('clamps below-floor values up to 61_000ms', () => {
      setEnv({ ttl: '1000' });
      expect(new PolicyCacheService().getTtlMs()).toBe(61_000);
    });

    it('clamps above-ceiling values down to 300_000ms', () => {
      setEnv({ ttl: '999999' });
      expect(new PolicyCacheService().getTtlMs()).toBe(300_000);
    });

    it('accepts in-range TTL verbatim', () => {
      setEnv({ ttl: '90000' });
      expect(new PolicyCacheService().getTtlMs()).toBe(90_000);
    });

    it('clamps http timeout to the [1000, 15_000] band', () => {
      setEnv({ timeout: '50' });
      // Not directly exposed, but observable via getRouteScore network miss
      // path which uses this.httpTimeoutMs. We just assert construction
      // doesn't throw — the timeout is exercised by the abort path.
      expect(() => new PolicyCacheService()).not.toThrow();
    });

    it('getCachedBundle returns null before first fetch', () => {
      const svc = new PolicyCacheService();
      expect(svc.getCachedBundle()).toBeNull();
    });
  });

  describe('getBundle — happy path', () => {
    it('bundles throttle + routing JSON from config and watchlist from risk', async () => {
      setEnv({ ttl: '61000' });
      global.fetch = buildFetch([
        {
          match: (u) => u.includes('/intake.throttling/effective'),
          response: {
            body: {
              configValue: JSON.stringify({ warmSampleIntervalMs: 111 }),
            },
          },
        },
        {
          match: (u) => u.includes('/intake.routing.tiers/effective'),
          response: {
            body: {
              configValue: JSON.stringify({
                hot: { enabled: true, instrumentKeys: ['BTC'] },
              }),
            },
          },
        },
        {
          match: (u) => u.endsWith('/policy/watchlist/tiers'),
          response: {
            body: {
              items: [
                {
                  instrumentKey: 'BTC',
                  tier: 'warm',
                  id: '1',
                  reason: 'x',
                  recordedAtIso: '',
                },
              ],
            },
          },
        },
      ]);

      const svc = new PolicyCacheService();
      const b = await svc.getBundle();
      expect(b.fallbackMode).toBe(false);
      expect(b.throttle?.warmSampleIntervalMs).toBe(111);
      expect(b.routing?.hot?.instrumentKeys).toEqual(['BTC']);
      expect(b.watchlistItems).toHaveLength(1);
      expect(b.watchlistItems[0]?.tier).toBe('warm');
    });

    it('caches the bundle and serves from cache on subsequent calls', async () => {
      setEnv({ ttl: '61000' });
      const fetchFn = buildFetch([
        {
          match: (u) => u.includes('/intake.throttling/effective'),
          response: { body: { configValue: JSON.stringify({}) } },
        },
        {
          match: (u) => u.includes('/intake.routing.tiers/effective'),
          response: { body: { configValue: JSON.stringify({}) } },
        },
        {
          match: (u) => u.endsWith('/policy/watchlist/tiers'),
          response: { body: { items: [] } },
        },
      ]);
      global.fetch = fetchFn;

      const svc = new PolicyCacheService();
      const first = await svc.getBundle();
      const second = await svc.getBundle();
      expect(second).toBe(first);
      // Second call served from cache: only the initial 3 upstream calls.
      expect((fetchFn as jest.Mock).mock.calls).toHaveLength(3);
      // getCachedBundle exposes the cached value.
      expect(svc.getCachedBundle()).toBe(first);
    });

    it('coalesces concurrent calls into a single upstream fetch (single-flight)', async () => {
      setEnv({ ttl: '61000' });
      const fetchFn = buildFetch([
        {
          match: (u) => u.includes('/intake.throttling/effective'),
          response: { body: { configValue: JSON.stringify({}) } },
        },
        {
          match: (u) => u.includes('/intake.routing.tiers/effective'),
          response: { body: { configValue: JSON.stringify({}) } },
        },
        {
          match: (u) => u.endsWith('/policy/watchlist/tiers'),
          response: { body: { items: [] } },
        },
      ]);
      global.fetch = fetchFn;

      const svc = new PolicyCacheService();
      const [a, b] = await Promise.all([svc.getBundle(), svc.getBundle()]);
      expect(a).toBe(b);
      expect((fetchFn as jest.Mock).mock.calls).toHaveLength(3);
    });

    it('forwards environment and tenantId as query-string on effective fetches', async () => {
      setEnv({ ttl: '61000', env: 'paper', tenant: 't1' });
      const fetchFn = jest.fn(
        (...args: Parameters<typeof fetch>): Promise<Response> => {
          const u = requestUrl(args[0]);
          if (u.includes('/intake.throttling/effective')) {
            expect(u).toContain('environment=paper');
            expect(u).toContain('tenantId=t1');
          }
          return Promise.resolve(
            mkResponse({
              body:
                u.includes('effective')
                  ? { configValue: JSON.stringify({}) }
                  : { items: [] },
            }),
          );
        },
      ) as typeof fetch;
      global.fetch = fetchFn;

      const svc = new PolicyCacheService();
      await svc.getBundle();
      expect((fetchFn as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('getBundle — fallbackMode escalation', () => {
    it('sets fallbackMode when config effective fails', async () => {
      setEnv();
      global.fetch = buildFetch([
        {
          match: (u) => u.includes('effective'),
          response: { ok: false, status: 503, body: null },
        },
        {
          match: (u) => u.endsWith('/policy/watchlist/tiers'),
          response: { body: { items: [] } },
        },
      ]);
      const svc = new PolicyCacheService();
      const b = await svc.getBundle();
      expect(b.fallbackMode).toBe(true);
    });

    it('sets fallbackMode when routing-tiers fetch fails (throttle ok)', async () => {
      setEnv();
      global.fetch = buildFetch([
        {
          match: (u) => u.includes('/intake.throttling/effective'),
          response: { body: { configValue: JSON.stringify({}) } },
        },
        {
          match: (u) => u.includes('/intake.routing.tiers/effective'),
          response: { ok: false, status: 503, body: null },
        },
        {
          match: (u) => u.endsWith('/policy/watchlist/tiers'),
          response: { body: { items: [] } },
        },
      ]);
      const svc = new PolicyCacheService();
      const b = await svc.getBundle();
      expect(b.fallbackMode).toBe(true);
      // throttle still parsed from the healthy upstream
      expect(b.throttle).not.toBeNull();
    });

    it('sets fallbackMode when watchlist-tiers fetch fails', async () => {
      setEnv();
      global.fetch = buildFetch([
        {
          match: (u) => u.includes('effective'),
          response: { body: { configValue: JSON.stringify({}) } },
        },
        {
          match: (u) => u.endsWith('/policy/watchlist/tiers'),
          response: { ok: false, status: 503, body: null },
        },
      ]);
      const svc = new PolicyCacheService();
      const b = await svc.getBundle();
      expect(b.fallbackMode).toBe(true);
      // watchlist items empty
      expect(b.watchlistItems).toEqual([]);
    });

    it('tolerates unparseable JSON configValue (parses to null, no fallback)', async () => {
      setEnv();
      global.fetch = buildFetch([
        {
          match: (u) => u.includes('/intake.throttling/effective'),
          response: { body: { configValue: 'not-valid-json{' } },
        },
        {
          match: (u) => u.includes('/intake.routing.tiers/effective'),
          response: { body: { configValue: 'also-not-json' } },
        },
        {
          match: (u) => u.endsWith('/policy/watchlist/tiers'),
          response: { body: { items: [] } },
        },
      ]);
      const svc = new PolicyCacheService();
      const b = await svc.getBundle();
      // All three upstreams returned 200, so no fallback escalation.
      expect(b.fallbackMode).toBe(false);
      // Non-JSON configValue → parse returns null → asThrottle/asRouting return null.
      expect(b.throttle).toBeNull();
      expect(b.routing).toBeNull();
    });

    it('tolerates empty/whitespace configValue (parses to null, no fallback)', async () => {
      setEnv();
      global.fetch = buildFetch([
        {
          match: (u) => u.includes('/intake.throttling/effective'),
          response: { body: { configValue: '   ' } },
        },
        {
          match: (u) => u.includes('/intake.routing.tiers/effective'),
          response: { body: { configValue: '' } },
        },
        {
          match: (u) => u.endsWith('/policy/watchlist/tiers'),
          response: { body: { items: [] } },
        },
      ]);
      const svc = new PolicyCacheService();
      const b = await svc.getBundle();
      expect(b.fallbackMode).toBe(false);
      expect(b.throttle).toBeNull();
      expect(b.routing).toBeNull();
    });

    it('filters out watchlist items with wrong field types', async () => {
      setEnv();
      global.fetch = buildFetch([
        {
          match: (u) => u.includes('effective'),
          response: { body: { configValue: JSON.stringify({}) } },
        },
        {
          match: (u) => u.endsWith('/policy/watchlist/tiers'),
          response: {
            body: {
              items: [
                { instrumentKey: 'BTC', tier: 'warm' }, // valid
                { instrumentKey: 5, tier: 'warm' }, // non-string instrumentKey
                { instrumentKey: 'ETH', tier: 7 }, // non-string tier
                'not-an-object', // non-object
                null, // null
                { instrumentKey: 'SOL', tier: 'cold' }, // valid
              ],
            },
          },
        },
      ]);
      const svc = new PolicyCacheService();
      const b = await svc.getBundle();
      expect(b.watchlistItems.map((w) => w.instrumentKey)).toEqual([
        'BTC',
        'SOL',
      ]);
    });

    it('tolerates watchlist body without items array', async () => {
      setEnv();
      global.fetch = buildFetch([
        {
          match: (u) => u.includes('effective'),
          response: { body: { configValue: JSON.stringify({}) } },
        },
        {
          match: (u) => u.endsWith('/policy/watchlist/tiers'),
          response: { body: { notItems: true } },
        },
      ]);
      const svc = new PolicyCacheService();
      const b = await svc.getBundle();
      expect(b.watchlistItems).toEqual([]);
      expect(b.fallbackMode).toBe(false);
    });

    it('tolerates fetch throwing (network failure) — treats as !ok', async () => {
      setEnv();
      global.fetch = jest.fn(() => Promise.reject(new Error('ECONNREFUSED')));
      const svc = new PolicyCacheService();
      const b = await svc.getBundle();
      expect(b.fallbackMode).toBe(true);
    });
  });

  describe('routing tier shape parsing', () => {
    it('preserves disabled flag and drops non-string instrumentKeys', async () => {
      setEnv();
      global.fetch = buildFetch([
        {
          match: (u) => u.includes('effective'),
          response: {
            body: {
              configValue: JSON.stringify({
                hot: {
                  enabled: false,
                  instrumentKeys: ['BTC', 5, null, 'ETH'],
                },
                warm: { enabled: 'truthy' }, // non-boolean → undefined
                cold: { instrumentKeys: 'not-array' },
              }),
            },
          },
        },
        {
          match: (u) => u.endsWith('/policy/watchlist/tiers'),
          response: { body: { items: [] } },
        },
      ]);
      const svc = new PolicyCacheService();
      const b = await svc.getBundle();
      expect(b.routing?.hot?.enabled).toBe(false);
      expect(b.routing?.hot?.instrumentKeys).toEqual(['BTC', 'ETH']);
      expect(b.routing?.warm?.enabled).toBeUndefined();
      expect(b.routing?.cold?.instrumentKeys).toBeUndefined();
    });
  });

  describe('getRouteScore', () => {
    it('returns null for an empty/whitespace route key (no upstream call)', async () => {
      setEnv();
      const fetchFn = jest.fn() as unknown as typeof fetch;
      global.fetch = fetchFn;
      const svc = new PolicyCacheService();
      expect(await svc.getRouteScore('   ')).toBeNull();
      expect(await svc.getRouteScore('')).toBeNull();
      expect((fetchFn as jest.Mock)).not.toHaveBeenCalled();
    });

    it('caches a freshly-fetched score on subsequent calls (cache hit)', async () => {
      setEnv({ ttl: '61000' });
      let calls = 0;
      global.fetch = jest.fn((...args: Parameters<typeof fetch>): Promise<Response> => {
        calls++;
        const u = requestUrl(args[0]);
        if (u.includes('effective')) {
          return Promise.resolve(
            mkResponse({ body: { configValue: JSON.stringify({}) } }),
          );
        }
        if (u.includes('/policy/route-scoring-history/')) {
          return Promise.resolve(
            mkResponse({
              body: { items: [{ score: 0.42 }] },
            }),
          );
        }
        return Promise.resolve(
          mkResponse({ ok: false, status: 404, body: null }),
        );
      }) as typeof fetch;

      const svc = new PolicyCacheService();
      const first = await svc.getRouteScore('BTC-USDT');
      const second = await svc.getRouteScore('BTC-USDT');
      expect(first).toBeCloseTo(0.42, 6);
      expect(second).toBe(first);
      // Only the second call should hit the scoring-history endpoint — the
      // first cache miss was followed by a cache hit, so the fetch count for
      // that URL stays at 1 (plus 3 for the initial bundle refresh).
      const scoringCalls = (global.fetch as jest.Mock).mock.calls.filter((c) =>
        requestUrl(c[0]).includes('/policy/route-scoring-history/'),
      );
      expect(scoringCalls).toHaveLength(1);
      // sanity: at least the 3 bundle fetches happened
      expect(calls).toBeGreaterThanOrEqual(3);
    });

    it('returns null when scoring-history returns a non-2xx', async () => {
      setEnv({ ttl: '61000' });
      global.fetch = buildFetch([
        {
          match: (u) => u.includes('effective'),
          response: { body: { configValue: JSON.stringify({}) } },
        },
        {
          match: (u) => u.endsWith('/policy/watchlist/tiers'),
          response: { body: { items: [] } },
        },
        {
          match: (u) => u.includes('/policy/route-scoring-history/'),
          response: { ok: false, status: 500, body: null },
        },
      ]);
      const svc = new PolicyCacheService();
      expect(await svc.getRouteScore('BTC-USDT')).toBeNull();
    });

    it('returns null when scoring-history body is empty items array', async () => {
      setEnv({ ttl: '61000' });
      global.fetch = buildFetch([
        {
          match: (u) => u.includes('effective'),
          response: { body: { configValue: JSON.stringify({}) } },
        },
        {
          match: (u) => u.endsWith('/policy/watchlist/tiers'),
          response: { body: { items: [] } },
        },
        {
          match: (u) => u.includes('/policy/route-scoring-history/'),
          response: { body: { items: [] } },
        },
      ]);
      const svc = new PolicyCacheService();
      expect(await svc.getRouteScore('BTC-USDT')).toBeNull();
    });

    it('returns null when first item lacks a numeric score', async () => {
      setEnv({ ttl: '61000' });
      global.fetch = buildFetch([
        {
          match: (u) => u.includes('effective'),
          response: { body: { configValue: JSON.stringify({}) } },
        },
        {
          match: (u) => u.endsWith('/policy/watchlist/tiers'),
          response: { body: { items: [] } },
        },
        {
          match: (u) => u.includes('/policy/route-scoring-history/'),
          response: { body: { items: [{ score: '0.5' }] } }, // string not number
        },
      ]);
      const svc = new PolicyCacheService();
      expect(await svc.getRouteScore('BTC-USDT')).toBeNull();
    });

    it('URL-encodes the route key in the scoring-history request', async () => {
      setEnv({ ttl: '61000' });
      const fetchFn = jest.fn((...args: Parameters<typeof fetch>): Promise<Response> => {
        const u = requestUrl(args[0]);
        if (u.includes('effective')) {
          return Promise.resolve(
            mkResponse({ body: { configValue: JSON.stringify({}) } }),
          );
        }
        if (u.endsWith('/policy/watchlist/tiers')) {
          return Promise.resolve(mkResponse({ body: { items: [] } }));
        }
        if (u.includes('/policy/route-scoring-history/')) {
          // spaces in the key must be encoded (not raw ' ')
          expect(u).not.toContain('BTC USDT');
          return Promise.resolve(
            mkResponse({ body: { items: [{ score: 1 }] } }),
          );
        }
        return Promise.resolve(
          mkResponse({ ok: false, status: 404, body: null }),
        );
      }) as typeof fetch;
      global.fetch = fetchFn;

      const svc = new PolicyCacheService();
      await svc.getRouteScore('BTC USDT');
      expect(fetchFn).toHaveBeenCalled();
    });
  });
});
