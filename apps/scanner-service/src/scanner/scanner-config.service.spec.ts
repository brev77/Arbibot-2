import { signedFetch } from '@arbibot/nest-platform';

import {
  DEFAULT_SCANNER_CONFIG_CACHE_TTL_MS,
  DEFAULT_SCANNER_RPC_RATE_LIMIT_RPS,
  SCANNER_DEFAULTS_POLICY_KEY,
  SCANNER_INSTANCES_POLICY_KEY,
} from './scanner-config.constants';
import { ScannerConfigService } from './scanner-config.service';

jest.mock('@arbibot/nest-platform', () => {
  const actual = jest.requireActual('@arbibot/nest-platform');
  return {
    ...actual,
    signedFetch: jest.fn(),
  };
});

describe('ScannerConfigService', () => {
  const originalEnv = process.env;
  // Cast once: the mock replaces signedFetch with a jest.Mock.
  const signedFetchMock = signedFetch as unknown as jest.Mock;

  let service: ScannerConfigService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CONFIG_SERVICE_URL;
    delete process.env.CONFIG_API_BASE;
    delete process.env.SCANNER_CONFIG_ENVIRONMENT;
    delete process.env.SCANNER_CONFIG_TENANT_ID;
    delete process.env.SCANNER_RPC_RATE_LIMIT_RPS;
    delete process.env.SCANNER_CONFIG_CACHE_TTL_MS;
    signedFetchMock.mockReset();
    service = new ScannerConfigService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  /** Helper: shape returned by config-service `/effective` (configValue is a JSON string). */
  const effectiveResponse = (value: unknown): Response =>
    ({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ configValue: JSON.stringify(value) }),
    }) as unknown as Response;

  describe('constructor (env baseline)', () => {
    it('resolves defaults from constants when no env / no remote', () => {
      expect(service.getConfig().defaults.rpcRateLimitRps).toBe(
        DEFAULT_SCANNER_RPC_RATE_LIMIT_RPS,
      );
    });

    it('honours SCANNER_RPC_RATE_LIMIT_RPS env override', () => {
      process.env.SCANNER_RPC_RATE_LIMIT_RPS = '7';
      const svc = new ScannerConfigService();
      expect(svc.getConfig().defaults.rpcRateLimitRps).toBe(7);
    });

    it('clamps negative env values to 0', () => {
      process.env.SCANNER_RPC_RATE_LIMIT_RPS = '-5';
      const svc = new ScannerConfigService();
      expect(svc.getConfig().defaults.rpcRateLimitRps).toBe(0);
    });

    it('has no instances from env baseline (config-service owns them)', () => {
      expect(service.getInstances()).toEqual([]);
      expect(service.getEnabledInstances()).toEqual([]);
    });
  });

  describe('ensureEffectiveConfigLoaded', () => {
    it('returns env defaults when CONFIG_SERVICE_URL is unset (no fetch)', async () => {
      await service.ensureEffectiveConfigLoaded();
      expect(signedFetchMock).not.toHaveBeenCalled();
      expect(service.getConfig().defaults.rpcRateLimitRps).toBe(
        DEFAULT_SCANNER_RPC_RATE_LIMIT_RPS,
      );
    });

    it('fetches defaults + instances on first call and merges remote', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
      signedFetchMock.mockImplementation((url: string) => {
        if (url.includes(SCANNER_DEFAULTS_POLICY_KEY)) {
          return Promise.resolve(
            effectiveResponse({ rpcRateLimitRps: 3, orphanMaxAttempts: 9 }),
          );
        }
        if (url.includes(SCANNER_INSTANCES_POLICY_KEY)) {
          return Promise.resolve(
            effectiveResponse({
              instances: [
                {
                  id: 'arb-2venue-1',
                  name: 'Arbitrum 2-venue',
                  network: 'arbitrum',
                  strategy: '2venue',
                  interval_ms: 2000,
                  enabled: true,
                },
              ],
            }),
          );
        }
        return Promise.reject(new Error(`unexpected url ${url}`));
      });

      await service.ensureEffectiveConfigLoaded();

      expect(service.getConfig().defaults.rpcRateLimitRps).toBe(3);
      expect(service.getConfig().defaults.orphanMaxAttempts).toBe(9);
      expect(service.getEnabledInstances()).toHaveLength(1);
      const enabled = service.getEnabledInstances()[0];
      expect(enabled?.id).toBe('arb-2venue-1');
    });

    it('handles empty instances array (seed 045) — worker stays idle', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
      signedFetchMock.mockResolvedValue(
        effectiveResponse({ instances: [] }),
      );

      await service.ensureEffectiveConfigLoaded();

      expect(service.getInstances()).toEqual([]);
      expect(service.getEnabledInstances()).toEqual([]);
    });

    it('uses cache on second call within TTL (no extra fetch)', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
      signedFetchMock.mockResolvedValue(effectiveResponse({}));

      await service.ensureEffectiveConfigLoaded();
      const firstCallCount = signedFetchMock.mock.calls.length;
      await service.ensureEffectiveConfigLoaded();

      expect(signedFetchMock.mock.calls.length).toBe(firstCallCount);
    });

    it('non-fatal: HTTP error falls back to env defaults', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
      signedFetchMock.mockResolvedValue({ ok: false, status: 500 });

      await service.ensureEffectiveConfigLoaded();

      expect(service.getConfig().defaults.rpcRateLimitRps).toBe(
        DEFAULT_SCANNER_RPC_RATE_LIMIT_RPS,
      );
      expect(service.getInstances()).toEqual([]);
    });

    it('non-fatal: network error falls back to env defaults', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
      signedFetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      await service.ensureEffectiveConfigLoaded();

      expect(service.getConfig().defaults.rpcRateLimitRps).toBe(
        DEFAULT_SCANNER_RPC_RATE_LIMIT_RPS,
      );
    });

    it('non-fatal: invalid JSON falls back to env defaults', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
      signedFetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ configValue: '{not json' }),
      });

      await service.ensureEffectiveConfigLoaded();

      expect(service.getConfig().defaults.rpcRateLimitRps).toBe(
        DEFAULT_SCANNER_RPC_RATE_LIMIT_RPS,
      );
    });
  });

  describe('forceRefresh', () => {
    it('bypasses the cache and re-fetches', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
      signedFetchMock.mockResolvedValue(effectiveResponse({}));

      await service.ensureEffectiveConfigLoaded();
      const firstCallCount = signedFetchMock.mock.calls.length;

      // Mutate remote to a new value and force-refresh.
      signedFetchMock.mockResolvedValue(effectiveResponse({ rpcRateLimitRps: 2 }));
      await service.forceRefresh();

      expect(signedFetchMock.mock.calls.length).toBeGreaterThan(firstCallCount);
      expect(service.getConfig().defaults.rpcRateLimitRps).toBe(2);
    });
  });

  describe('cache TTL clamp', () => {
    it('clamps SCANNER_CONFIG_CACHE_TTL_MS to [5s, 300s]', () => {
      process.env.SCANNER_CONFIG_CACHE_TTL_MS = '1000'; // below floor
      const svcLow = new ScannerConfigService();
      expect(svcLow.getConfig().defaults.configCacheTtlMs).toBe(5000);

      process.env.SCANNER_CONFIG_CACHE_TTL_MS = '999999'; // above ceiling
      const svcHigh = new ScannerConfigService();
      expect(svcHigh.getConfig().defaults.configCacheTtlMs).toBe(300000);

      process.env.SCANNER_CONFIG_CACHE_TTL_MS = String(
        DEFAULT_SCANNER_CONFIG_CACHE_TTL_MS,
      );
      const svcOk = new ScannerConfigService();
      expect(svcOk.getConfig().defaults.configCacheTtlMs).toBe(
        DEFAULT_SCANNER_CONFIG_CACHE_TTL_MS,
      );
    });
  });

  describe('effective-config fetch — env query params', () => {
    it('forwards SCANNER_CONFIG_ENVIRONMENT + SCANNER_CONFIG_TENANT_ID as query params', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
      process.env.SCANNER_CONFIG_ENVIRONMENT = 'paper';
      process.env.SCANNER_CONFIG_TENANT_ID = 'tenant-42';
      signedFetchMock.mockResolvedValue(effectiveResponse({}));

      await service.ensureEffectiveConfigLoaded();

      const urls = signedFetchMock.mock.calls.map((c) => c[0] as string);
      expect(urls.some((u) => u.includes('environment=paper'))).toBe(true);
      expect(urls.some((u) => u.includes('tenantId=tenant-42'))).toBe(true);
    });
  });

  describe('effective-config fetch — error shapes', () => {
    it('returns null when configValue is missing from the response body', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
      signedFetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}), // no configValue
      });

      await service.ensureEffectiveConfigLoaded();

      // Env defaults retained (remote treated as null).
      expect(service.getConfig().defaults.rpcRateLimitRps).toBe(
        DEFAULT_SCANNER_RPC_RATE_LIMIT_RPS,
      );
    });

    it('returns null when configValue is not a string', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
      signedFetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ configValue: { not: 'a string' } }),
      });

      await service.ensureEffectiveConfigLoaded();

      expect(service.getConfig().defaults.rpcRateLimitRps).toBe(
        DEFAULT_SCANNER_RPC_RATE_LIMIT_RPS,
      );
    });
  });

  describe('mergeWithRemote — per-key clamping + non-finite guards', () => {
    it('applies each remote default with a Math.max floor', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
      signedFetchMock.mockImplementation((url: string) => {
        if (url.includes(SCANNER_DEFAULTS_POLICY_KEY)) {
          return Promise.resolve(
            effectiveResponse({
              findingsRetentionDays: 14,
              rpcRateLimitRps: 20,
              poolCacheTtlMs: 60000,
              dedupCooldownMs: 90000,
              orphanRetryIntervalMs: 120000,
              orphanMaxAttempts: 7,
              opportunityPublishTimeoutMs: 8000,
              defaultFilters: { minSpreadBps: 50 },
            }),
          );
        }
        return Promise.resolve(effectiveResponse({ instances: [] }));
      });

      await service.ensureEffectiveConfigLoaded();

      const d = service.getConfig().defaults;
      expect(d.findingsRetentionDays).toBe(14);
      expect(d.rpcRateLimitRps).toBe(20);
      expect(d.poolCacheTtlMs).toBe(60000);
      expect(d.dedupCooldownMs).toBe(90000);
      expect(d.orphanRetryIntervalMs).toBe(120000);
      expect(d.orphanMaxAttempts).toBe(7);
      expect(d.opportunityPublishTimeoutMs).toBe(8000);
    });

    it('clamps retention to Math.max(1, v) — negative remote falls back', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
      signedFetchMock.mockImplementation((url: string) => {
        if (url.includes(SCANNER_DEFAULTS_POLICY_KEY)) {
          return Promise.resolve(
            effectiveResponse({ findingsRetentionDays: -5 }),
          );
        }
        return Promise.resolve(effectiveResponse({ instances: [] }));
      });

      await service.ensureEffectiveConfigLoaded();

      // -5 is finite but < 1 → Math.max(1,-5)=1 applies
      expect(service.getConfig().defaults.findingsRetentionDays).toBe(1);
    });

    it('retains env baseline when a remote value is non-finite', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
      signedFetchMock.mockImplementation((url: string) => {
        if (url.includes(SCANNER_DEFAULTS_POLICY_KEY)) {
          return Promise.resolve(
            effectiveResponse({
              rpcRateLimitRps: Number.NaN,
              orphanMaxAttempts: Number.POSITIVE_INFINITY,
              poolCacheTtlMs: 'not-a-number' as unknown as number,
            }),
          );
        }
        return Promise.resolve(effectiveResponse({ instances: [] }));
      });

      await service.ensureEffectiveConfigLoaded();

      const d = service.getConfig().defaults;
      // Non-finite remote values are ignored → env baseline retained.
      expect(d.rpcRateLimitRps).toBe(DEFAULT_SCANNER_RPC_RATE_LIMIT_RPS);
    });
  });

  describe('extractInstances — normalization + clamp', () => {
    it('normalizes camelCase intervalMs to snake_case interval_ms', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
      signedFetchMock.mockResolvedValue(
        effectiveResponse({
          instances: [
            {
              id: 'arb-1',
              name: 'test',
              network: 'arbitrum',
              strategy: '2venue',
              intervalMs: 3000, // camelCase variant
              enabled: true,
            },
          ],
        }),
      );

      await service.ensureEffectiveConfigLoaded();

      const inst = service.getInstances()[0];
      expect(inst?.interval_ms).toBe(3000);
    });

    it('clamps interval_ms to the MIN_SCANNER_INSTANCE_INTERVAL_MS floor', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
      signedFetchMock.mockResolvedValue(
        effectiveResponse({
          instances: [
            {
              id: 'arb-1',
              name: 'test',
              network: 'arbitrum',
              strategy: '2venue',
              interval_ms: 10, // below floor
              enabled: true,
            },
          ],
        }),
      );

      await service.ensureEffectiveConfigLoaded();

      const inst = service.getInstances()[0];
      expect(inst?.interval_ms).toBeGreaterThanOrEqual(100); // MIN floor
    });

    it('filters out non-object instance entries', async () => {
      process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
      signedFetchMock.mockResolvedValue(
        effectiveResponse({
          instances: [
            null,
            'not-an-object',
            { id: 'arb-1', network: 'arbitrum', strategy: '2venue', interval_ms: 2000, enabled: true },
          ],
        }),
      );

      await service.ensureEffectiveConfigLoaded();

      expect(service.getInstances()).toHaveLength(1);
      expect(service.getInstances()[0]?.id).toBe('arb-1');
    });
  });
});
