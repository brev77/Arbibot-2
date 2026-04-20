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

describe('PolicyCacheService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.CONFIG_SERVICE_URL;
    delete process.env.RISK_SERVICE_URL;
    delete process.env.INTAKE_POLICY_CACHE_TTL_MS;
  });

  it('bundles throttle + routing JSON from config and watchlist from risk', async () => {
    process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
    process.env.RISK_SERVICE_URL = 'http://risk.test';
    process.env.INTAKE_POLICY_CACHE_TTL_MS = '61000';

    global.fetch = jest.fn((...args: Parameters<typeof fetch>): Promise<Response> => {
      const u = requestUrl(args[0]);
      if (u.includes('/intake.throttling/effective')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              configValue: JSON.stringify({ warmSampleIntervalMs: 111 }),
            }),
        } as Response);
      }
      if (u.includes('/intake.routing.tiers/effective')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              configValue: JSON.stringify({
                hot: { enabled: true, instrumentKeys: ['BTC'] },
              }),
            }),
        } as Response);
      }
      if (u.endsWith('/policy/watchlist/tiers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              items: [
                {
                  instrumentKey: 'BTC',
                  tier: 'warm',
                  id: '1',
                  reason: 'x',
                  recordedAtIso: '',
                },
              ],
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve(null),
      } as Response);
    }) as typeof fetch;

    const svc = new PolicyCacheService();
    const b = await svc.getBundle();
    expect(b.fallbackMode).toBe(false);
    expect(b.throttle?.warmSampleIntervalMs).toBe(111);
    expect(b.routing?.hot?.instrumentKeys).toEqual(['BTC']);
    expect(b.watchlistItems).toHaveLength(1);
    expect(b.watchlistItems[0]?.tier).toBe('warm');
  });

  it('sets fallbackMode when config effective fails', async () => {
    process.env.CONFIG_SERVICE_URL = 'http://cfg.test';
    process.env.RISK_SERVICE_URL = 'http://risk.test';

    global.fetch = jest.fn((...args: Parameters<typeof fetch>): Promise<Response> => {
      const u = requestUrl(args[0]);
      if (u.includes('effective')) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: () => Promise.resolve(null),
        } as Response);
      }
      if (u.endsWith('/policy/watchlist/tiers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ items: [] }),
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve(null),
      } as Response);
    }) as typeof fetch;

    const svc = new PolicyCacheService();
    const b = await svc.getBundle();
    expect(b.fallbackMode).toBe(true);
  });
});
