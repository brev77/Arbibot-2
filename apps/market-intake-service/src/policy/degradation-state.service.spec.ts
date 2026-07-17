import { DegradationStateService } from './degradation-state.service';
import { PolicyCacheService } from './policy-cache.service';
import type { PolicyBundle } from './policy-types';

/**
 * DegradationStateService spec (Phase 4 — operator degradation banner data).
 *
 * Tracks throttle events in a 5-minute sliding window and exposes a snapshot
 * the operator UI polls via /health/degradation. PolicyCacheService provides
 * the cached bundle (fallbackMode, fetchedAt) + TTL.
 */
describe('DegradationStateService', () => {
  const originalEnv = process.env;
  let policyCache: {
    getCachedBundle: jest.Mock;
    getTtlMs: jest.Mock;
  };
  let service: DegradationStateService;

  const mkBundle = (over: Partial<PolicyBundle> = {}): PolicyBundle => ({
    throttle: null,
    routing: null,
    watchlistItems: [],
    routeScoreByKey: new Map(),
    fetchedAtMs: 1_000_000,
    fallbackMode: false,
    ...over,
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.INTAKE_THROTTLING_ENABLED;
    policyCache = {
      getCachedBundle: jest.fn().mockReturnValue(null),
      getTtlMs: jest.fn().mockReturnValue(60_000),
    };
    service = new DegradationStateService(
      policyCache as unknown as PolicyCacheService,
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getSnapshot', () => {
    it('reports fallbackMode=false when no cached bundle exists', () => {
      const snap = service.getSnapshot();

      expect(snap).toEqual({
        fallbackMode: false,
        policyCacheTtlMs: 60_000,
        lastPolicyRefreshAtIso: null,
        throttledCount5m: 0,
        intakeThrottlingEnabled: false,
      });
    });

    it('reflects fallbackMode + lastPolicyRefreshAtIso from the cached bundle', () => {
      policyCache.getCachedBundle.mockReturnValue(
        mkBundle({ fallbackMode: true, fetchedAtMs: 1_750_000_000_000 }),
      );

      const snap = service.getSnapshot();

      expect(snap.fallbackMode).toBe(true);
      expect(snap.lastPolicyRefreshAtIso).toBe(
        new Date(1_750_000_000_000).toISOString(),
      );
    });

    it('reads INTAKE_THROTTLING_ENABLED from env', () => {
      process.env.INTAKE_THROTTLING_ENABLED = 'true';
      expect(service.getSnapshot().intakeThrottlingEnabled).toBe(true);

      process.env.INTAKE_THROTTLING_ENABLED = 'false';
      expect(service.getSnapshot().intakeThrottlingEnabled).toBe(false);
    });
  });

  describe('throttle event window', () => {
    it('counts throttle events recorded within the 5-minute window', () => {
      service.recordThrottle();
      service.recordThrottle();
      service.recordThrottle();

      expect(service.getSnapshot().throttledCount5m).toBe(3);
    });

    it('prunes events older than 5 minutes on each getSnapshot', () => {
      service.recordThrottle();
      service.recordThrottle();

      // Shift the internal timestamps back beyond the 5-minute window.
      const realNow = Date.now;
      const future = realNow() + 6 * 60 * 1000;
      Date.now = () => future;
      try {
        expect(service.getSnapshot().throttledCount5m).toBe(0);
      } finally {
        Date.now = realNow;
      }
    });

    it('recordThrottle itself prunes stale entries (cap on array growth)', () => {
      const realNow = Date.now;
      const t0 = realNow();
      Date.now = () => t0;
      try {
        service.recordThrottle();
        service.recordThrottle();
      } finally {
        Date.now = realNow;
      }

      // Advance well past 5 minutes and record again -> prior entries pruned.
      Date.now = () => t0 + 10 * 60 * 1000;
      try {
        service.recordThrottle();
        expect(service.getSnapshot().throttledCount5m).toBe(1);
      } finally {
        Date.now = realNow;
      }
    });
  });
});
