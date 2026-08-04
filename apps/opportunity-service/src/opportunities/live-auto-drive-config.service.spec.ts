import { LiveAutoDriveConfigService, LiveAutoDrivePolicyJson } from './live-auto-drive-config.service';
import { LIVE_AUTO_DRIVE_POLICY_KEY } from './live-auto-drive-config.constants';

/**
 * PLAN10 P10-1 — LiveAutoDriveConfigService spec.
 *
 * Mirrors the paper AutoDriveConfigService pattern. Covers env parse, type-safe remote
 * merge, cache TTL, fetch-failure→env fallback, and isEnabled() after merge. The
 * `enabled` kill-switch defaults to `false` (safe-by-default) — critical: live auto-trade
 * must never start without explicit operator opt-in.
 */

const ENV_KEYS = [
  'LIVE_AUTO_DRIVE_ENABLED',
  'LIVE_AUTO_DRIVE_INTERVAL_MS',
  'LIVE_AUTO_DRIVE_MIN_NET_PROFIT_USD',
  'LIVE_AUTO_DRIVE_MAX_CONCURRENT_PLANS',
  'LIVE_NOTIONAL_USD',
  'LIVE_AUTO_DRIVE_BATCH_SIZE',
  'LIVE_AUTO_DRIVE_CONFIG_CACHE_MS',
  'LIVE_AUTO_DRIVE_CONFIG_ENVIRONMENT',
  'LIVE_AUTO_DRIVE_CONFIG_TENANT_ID',
  'CONFIG_SERVICE_URL',
  'CONFIG_API_BASE',
  'NODE_ENV',
] as const;

function clearEnv(): void {
  for (const k of ENV_KEYS) {
    delete process.env[k];
  }
}

// Direct-assignment mock target (avoids jest.spyOn generic-inference issues on
// private methods via intersection types, which collapse to `never`). We override
// the method on the instance instead of spying.
type ConfigServiceWithInternals = {
  fetchEffectiveLiveAutoDrive: () => Promise<LiveAutoDrivePolicyJson | null>;
};

describe('LiveAutoDriveConfigService', () => {
  beforeEach(() => {
    clearEnv();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    clearEnv();
  });

  it('defaults to disabled (safe-by-default) with conservative live values', () => {
    const svc = new LiveAutoDriveConfigService();
    const cfg = svc.getConfig();
    expect(cfg.enabled).toBe(false); // critical: live must opt-in
    expect(cfg.intervalMs).toBe(10_000);
    expect(cfg.minNetProfitUsd).toBe(5);
    expect(cfg.maxConcurrentPlans).toBe(3);
    expect(cfg.notionalUsd).toBe(50); // $50 not $1000 (live < paper)
    expect(cfg.batchSize).toBe(1);
    expect(svc.isEnabled()).toBe(false);
  });

  it('parses env baseline (enabled via LIVE_AUTO_DRIVE_ENABLED=true)', () => {
    process.env.LIVE_AUTO_DRIVE_ENABLED = 'true';
    process.env.LIVE_NOTIONAL_USD = '10';
    process.env.LIVE_AUTO_DRIVE_MAX_CONCURRENT_PLANS = '1';
    const svc = new LiveAutoDriveConfigService();
    const cfg = svc.getConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.notionalUsd).toBe(10);
    expect(cfg.maxConcurrentPlans).toBe(1);
    expect(svc.isEnabled()).toBe(true);
  });

  it('clamps intervalMs and batchSize to minimums', () => {
    process.env.LIVE_AUTO_DRIVE_INTERVAL_MS = '100'; // below min 1000
    process.env.LIVE_AUTO_DRIVE_BATCH_SIZE = '0'; // below min 1
    const svc = new LiveAutoDriveConfigService();
    const cfg = svc.getConfig();
    expect(cfg.intervalMs).toBe(1000); // clamped
    expect(cfg.batchSize).toBe(1); // clamped
  });

  it('applyRemoteJson overrides env only for well-typed fields', async () => {
    process.env.LIVE_AUTO_DRIVE_ENABLED = 'true';
    process.env.LIVE_NOTIONAL_USD = '10';
    const svc = new LiveAutoDriveConfigService();
    const remote: LiveAutoDrivePolicyJson = {
      enabled: false,
      notionalUsd: 50,
      minNetProfitUsd: 'not-a-number' as unknown as number, // ignored
      maxConcurrentPlans: 5,
    };
    let calls = 0;
    (svc as unknown as ConfigServiceWithInternals).fetchEffectiveLiveAutoDrive = () => {
      calls += 1;
      return Promise.resolve(remote);
    };
    await svc.ensureEffectiveConfigLoaded();
    const cfg = svc.getConfig();
    expect(cfg.enabled).toBe(false); // remote override wins
    expect(cfg.notionalUsd).toBe(50); // remote override
    expect(cfg.maxConcurrentPlans).toBe(5); // remote override
    expect(cfg.minNetProfitUsd).toBe(5); // env default (remote bad-typed ignored)
    expect(svc.isEnabled()).toBe(false);
    expect(calls).toBe(1);
  });

  it('falls back to env baseline when config-service is unreachable', async () => {
    process.env.LIVE_AUTO_DRIVE_ENABLED = 'true';
    process.env.LIVE_NOTIONAL_USD = '15';
    process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
    const svc = new LiveAutoDriveConfigService();
    (svc as unknown as ConfigServiceWithInternals).fetchEffectiveLiveAutoDrive = () =>
      Promise.reject(new Error('ECONNREFUSED'));
    await svc.ensureEffectiveConfigLoaded(); // never throws
    const cfg = svc.getConfig();
    expect(cfg.enabled).toBe(true); // env baseline preserved
    expect(cfg.notionalUsd).toBe(15);
  });

  it('uses env only when CONFIG_SERVICE_URL is unset', async () => {
    process.env.LIVE_AUTO_DRIVE_ENABLED = 'true';
    const svc = new LiveAutoDriveConfigService();
    await svc.ensureEffectiveConfigLoaded();
    expect(svc.isEnabled()).toBe(true);
  });

  it('cache TTL prevents refetch within window', async () => {
    process.env.LIVE_AUTO_DRIVE_ENABLED = 'true';
    process.env.CONFIG_SERVICE_URL = 'http://127.0.0.1:3019';
    process.env.LIVE_AUTO_DRIVE_CONFIG_CACHE_MS = '60000';
    const svc = new LiveAutoDriveConfigService();
    let calls = 0;
    (svc as unknown as ConfigServiceWithInternals).fetchEffectiveLiveAutoDrive = () => {
      calls += 1;
      return Promise.resolve({ enabled: false });
    };
    await svc.ensureEffectiveConfigLoaded();
    await svc.ensureEffectiveConfigLoaded(); // should hit cache
    expect(calls).toBe(1); // not refetched
  });

  it('uses the correct policy key in the URL', () => {
    expect(LIVE_AUTO_DRIVE_POLICY_KEY).toBe('live.auto_drive');
  });
});
