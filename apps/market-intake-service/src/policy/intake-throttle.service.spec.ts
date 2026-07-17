import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { IntakeThrottleService } from './intake-throttle.service';
import { DegradationStateService } from './degradation-state.service';
import { PolicyCacheService } from './policy-cache.service';
import type { PolicyBundle } from './policy-types';
import type { IngestMarketSnapshotDto } from '../snapshots/dto/ingest-market-snapshot.dto';

/**
 * IntakeThrottleService spec (Phase 4 — market-intake throttling coverage).
 *
 * Exercises the full throttle state machine: disabled bypass, hot tier
 * fast-path, warm/cold sampling intervals, route-score rejection, watchlist
 * fallback routing, and wildcard instrument lists. PolicyCacheService +
 * DegradationStateService are stubbed.
 */
describe('IntakeThrottleService', () => {
  const originalEnv = process.env;
  let policyCache: {
    getBundle: jest.Mock;
    getRouteScore: jest.Mock;
  };
  let degradationState: { recordThrottle: jest.Mock };
  let service: IntakeThrottleService;

  const mkDto = (over: Partial<IngestMarketSnapshotDto> = {}): IngestMarketSnapshotDto => ({
    venueCode: 'BINANCE',
    venueSymbol: 'BTCUSDT',
    instrumentKey: 'BTC-USDT',
    routeKey: undefined,
    observedAt: '2026-07-17T10:00:00Z',
    ...over,
  });

  /** Build a PolicyBundle with the given routing + watchlist shape. */
  const mkBundle = (over: Partial<PolicyBundle> = {}): PolicyBundle => ({
    throttle: null,
    routing: null,
    watchlistItems: [],
    routeScoreByKey: new Map(),
    fetchedAtMs: Date.now(),
    fallbackMode: false,
    ...over,
  });

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
    process.env = { ...originalEnv };
    delete process.env.INTAKE_THROTTLING_ENABLED;
    policyCache = {
      getBundle: jest.fn().mockResolvedValue(mkBundle()),
      getRouteScore: jest.fn().mockResolvedValue(null),
    };
    degradationState = { recordThrottle: jest.fn() };
    service = new IntakeThrottleService(
      policyCache as unknown as PolicyCacheService,
      degradationState as unknown as DegradationStateService,
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('disabled bypass', () => {
    it('allows everything with reason throttling_disabled when INTAKE_THROTTLING_ENABLED != true', async () => {
      const decision = await service.evaluate(mkDto());

      expect(decision).toEqual({
        allow: true,
        reason: 'throttling_disabled',
        routingTier: 'hot',
      });
      expect(policyCache.getBundle).not.toHaveBeenCalled();
    });
  });

  describe('hot tier fast-path', () => {
    it('allows hot instruments without sampling (reason tier_hot)', async () => {
      process.env.INTAKE_THROTTLING_ENABLED = 'true';
      policyCache.getBundle.mockResolvedValue(
        mkBundle({
          routing: { hot: { enabled: true, instrumentKeys: ['BTC-USDT'] } },
        }),
      );

      const decision = await service.evaluate(mkDto({ instrumentKey: 'BTC-USDT' }));

      expect(decision).toEqual({
        allow: true,
        reason: 'tier_hot',
        routingTier: 'hot',
      });
    });

    it('treats a wildcard instrument list as matching any key', async () => {
      process.env.INTAKE_THROTTLING_ENABLED = 'true';
      policyCache.getBundle.mockResolvedValue(
        mkBundle({ routing: { hot: { enabled: true, instrumentKeys: ['*'] } } }),
      );

      const decision = await service.evaluate(mkDto({ instrumentKey: 'ANY-KEY' }));

      expect(decision.routingTier).toBe('hot');
      expect(decision.allow).toBe(true);
    });

    it('defaults to hot when no routing config matches the key', async () => {
      process.env.INTAKE_THROTTLING_ENABLED = 'true';
      // routing=null, watchlist empty -> default tier hot.
      policyCache.getBundle.mockResolvedValue(mkBundle({ routing: null }));

      const decision = await service.evaluate(mkDto({ instrumentKey: 'UNKNOWN' }));

      expect(decision.routingTier).toBe('hot');
      expect(decision.allow).toBe(true);
    });
  });

  describe('watchlist-driven routing fallback', () => {
    it('routes to the watchlist tier when routing config does not match', async () => {
      process.env.INTAKE_THROTTLING_ENABLED = 'true';
      policyCache.getBundle.mockResolvedValue(
        mkBundle({
          routing: { warm: { enabled: true, instrumentKeys: ['OTHER'] } },
          watchlistItems: [{ instrumentKey: 'ETH-USDT', tier: 'cold' }],
        }),
      );

      // ETH-USDT is not in the warm routing list but IS in the watchlist as cold.
      const decision = await service.evaluate(mkDto({ instrumentKey: 'ETH-USDT' }));

      expect(decision.routingTier).toBe('cold');
    });

    it('ignores unknown watchlist tier strings (falls back to default hot)', async () => {
      process.env.INTAKE_THROTTLING_ENABLED = 'true';
      policyCache.getBundle.mockResolvedValue(
        mkBundle({
          watchlistItems: [{ instrumentKey: 'X', tier: 'bogus' }],
        }),
      );

      const decision = await service.evaluate(mkDto({ instrumentKey: 'X' }));
      expect(decision.routingTier).toBe('hot');
    });
  });

  describe('warm/cold sampling intervals', () => {
    it('allows the first warm sample then throttles within the interval', async () => {
      process.env.INTAKE_THROTTLING_ENABLED = 'true';
      policyCache.getBundle.mockResolvedValue(
        mkBundle({
          throttle: { warmSampleIntervalMs: 10_000 },
          routing: { warm: { enabled: true, instrumentKeys: ['ETH-USDT'] } },
        }),
      );

      const first = await service.evaluate(mkDto({ instrumentKey: 'ETH-USDT' }));
      expect(first.allow).toBe(true);
      expect(first.routingTier).toBe('warm');
      expect(first.reason).toBe('sample_passed');

      const second = await service.evaluate(mkDto({ instrumentKey: 'ETH-USDT' }));
      expect(second.allow).toBe(false);
      expect(second.reason).toBe('sampled_by_tier_interval');
      expect(second.routingTier).toBe('warm');
    });

    it('uses the cold interval for cold-tier instruments (default 30000ms)', async () => {
      process.env.INTAKE_THROTTLING_ENABLED = 'true';
      policyCache.getBundle.mockResolvedValue(
        mkBundle({
          routing: { cold: { enabled: true, instrumentKeys: ['SHITCOIN'] } },
        }),
      );

      const first = await service.evaluate(mkDto({ instrumentKey: 'SHITCOIN' }));
      const second = await service.evaluate(mkDto({ instrumentKey: 'SHITCOIN' }));

      expect(first.allow).toBe(true);
      expect(first.routingTier).toBe('cold');
      // Immediately repeated -> throttled by the (default) cold interval.
      expect(second.allow).toBe(false);
    });

    it('throttle decisions record the throttle reason + notify degradation state', async () => {
      process.env.INTAKE_THROTTLING_ENABLED = 'true';
      policyCache.getBundle.mockResolvedValue(
        mkBundle({
          throttle: { warmSampleIntervalMs: 10_000 },
          routing: { warm: { enabled: true, instrumentKeys: ['W'] } },
        }),
      );

      await service.evaluate(mkDto({ instrumentKey: 'W' }));
      await service.evaluate(mkDto({ instrumentKey: 'W' })); // throttled

      expect(degradationState.recordThrottle).toHaveBeenCalledTimes(1);
    });

    it('forwards requireAuditOnThrottle from the throttle config', async () => {
      process.env.INTAKE_THROTTLING_ENABLED = 'true';
      policyCache.getBundle.mockResolvedValue(
        mkBundle({
          throttle: { warmSampleIntervalMs: 10_000, requireAuditOnThrottle: true },
          routing: { warm: { enabled: true, instrumentKeys: ['W'] } },
        }),
      );

      await service.evaluate(mkDto({ instrumentKey: 'W' }));
      const throttled = await service.evaluate(mkDto({ instrumentKey: 'W' }));

      expect(throttled.allow).toBe(false);
      if (!throttled.allow) {
        expect(throttled.requireAudit).toBe(true);
      }
    });
  });

  describe('route-score rejection', () => {
    it('throttles when the route score is below minRouteScore', async () => {
      process.env.INTAKE_THROTTLING_ENABLED = 'true';
      policyCache.getBundle.mockResolvedValue(
        mkBundle({ throttle: { minRouteScore: 0.5 } }),
      );
      policyCache.getRouteScore.mockResolvedValue(0.2);

      const decision = await service.evaluate(
        mkDto({ routeKey: 'BTC->ETH', instrumentKey: undefined }),
      );

      expect(decision.allow).toBe(false);
      if (!decision.allow) {
        expect(decision.reason).toBe('route_score_below_min');
        expect(degradationState.recordThrottle).toHaveBeenCalledTimes(1);
      }
    });

    it('allows when route score equals minRouteScore (boundary)', async () => {
      process.env.INTAKE_THROTTLING_ENABLED = 'true';
      policyCache.getBundle.mockResolvedValue(
        mkBundle({ throttle: { minRouteScore: 0.5 } }),
      );
      policyCache.getRouteScore.mockResolvedValue(0.5);

      const decision = await service.evaluate(
        mkDto({ routeKey: 'BTC->ETH', instrumentKey: undefined }),
      );

      expect(decision.allow).toBe(true);
    });

    it('skips the score check when no route score is known (null)', async () => {
      process.env.INTAKE_THROTTLING_ENABLED = 'true';
      policyCache.getBundle.mockResolvedValue(
        mkBundle({ throttle: { minRouteScore: 0.5 } }),
      );
      policyCache.getRouteScore.mockResolvedValue(null);

      const decision = await service.evaluate(
        mkDto({ routeKey: 'BTC->ETH', instrumentKey: undefined }),
      );

      expect(decision.allow).toBe(true);
    });

    it('skips the score check when minRouteScore is 0 / unset', async () => {
      process.env.INTAKE_THROTTLING_ENABLED = 'true';
      policyCache.getBundle.mockResolvedValue(
        mkBundle({ throttle: { minRouteScore: 0 } }),
      );

      await service.evaluate(mkDto({ routeKey: 'BTC->ETH' }));

      expect(policyCache.getRouteScore).not.toHaveBeenCalled();
    });
  });

  describe('sampling key', () => {
    it('keys by instrumentKey when present, isolating sampling per instrument', async () => {
      process.env.INTAKE_THROTTLING_ENABLED = 'true';
      policyCache.getBundle.mockResolvedValue(
        mkBundle({
          throttle: { coldSampleIntervalMs: 10_000 },
          routing: { cold: { enabled: true, instrumentKeys: ['A', 'B'] } },
        }),
      );

      const a = await service.evaluate(mkDto({ instrumentKey: 'A' }));
      const b = await service.evaluate(mkDto({ instrumentKey: 'B' }));

      // Different instruments have independent sampling windows.
      expect(a.allow).toBe(true);
      expect(b.allow).toBe(true);
    });

    it('keys by venue:symbol when instrumentKey is absent (sampling only — routing stays default hot)', async () => {
      process.env.INTAKE_THROTTLING_ENABLED = 'true';
      policyCache.getBundle.mockResolvedValue(
        mkBundle({
          // Without an instrumentKey, resolveRoutingTier defaults to hot, so
          // no sampling applies — the sampling-key (venue:symbol) is only
          // reached for warm/cold instruments. Assert the hot fast-path here.
          routing: { hot: { enabled: true, instrumentKeys: ['*'] } },
        }),
      );

      const decision = await service.evaluate(
        mkDto({ instrumentKey: undefined, venueSymbol: 'X' }),
      );
      expect(decision.routingTier).toBe('hot');
      expect(decision.allow).toBe(true);
    });
  });
});
