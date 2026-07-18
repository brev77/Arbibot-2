import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { SafeModeService } from './safe-mode.service';

/**
 * SafeModeService spec (Phase 4 — hermes-gateway safe-mode coverage).
 *
 * Safe mode persists to Redis when HERMES_SAFE_MODE_REDIS_URL / REDIS_URL is
 * set (unless HERMES_SAFE_MODE_USE_MEMORY_ONLY=true). Otherwise the state is
 * held in-process and reset on each `new SafeModeService()`. The metrics
 * counter increments on Redis failures; we exercise both in-memory toggles
 * and Redis-backed success/failure paths with a mock Redis client.
 *
 * Redis is not constructed directly (would require a live instance); instead
 * we instantiate the service in memory-only mode, then replace the private
 * `redis` field with a mock to exercise the Redis code path.
 */
describe('SafeModeService', () => {
  const prevMemory = process.env.HERMES_SAFE_MODE_USE_MEMORY_ONLY;
  const prevRedisUrl = process.env.HERMES_SAFE_MODE_REDIS_URL;
  const prevFallbackRedis = process.env.REDIS_URL;
  const prevTtl = process.env.HERMES_SAFE_MODE_REDIS_TTL_SECONDS;

  beforeEach(() => {
    process.env.HERMES_SAFE_MODE_USE_MEMORY_ONLY = 'true';
    delete process.env.HERMES_SAFE_MODE_REDIS_URL;
    delete process.env.REDIS_URL;
    delete process.env.HERMES_SAFE_MODE_REDIS_TTL_SECONDS;
  });

  afterEach(() => {
    if (prevMemory === undefined) {
      delete process.env.HERMES_SAFE_MODE_USE_MEMORY_ONLY;
    } else {
      process.env.HERMES_SAFE_MODE_USE_MEMORY_ONLY = prevMemory;
    }
    if (prevRedisUrl === undefined) {
      delete process.env.HERMES_SAFE_MODE_REDIS_URL;
    } else {
      process.env.HERMES_SAFE_MODE_REDIS_URL = prevRedisUrl;
    }
    if (prevFallbackRedis === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = prevFallbackRedis;
    }
    if (prevTtl === undefined) {
      delete process.env.HERMES_SAFE_MODE_REDIS_TTL_SECONDS;
    } else {
      process.env.HERMES_SAFE_MODE_REDIS_TTL_SECONDS = prevTtl;
    }
  });

  /**
   * Attach a mock Redis client to a service instance by overriding the
   * private readonly field. We use this to exercise the Redis code paths
   * without constructing a real ioredis connection.
   */
  function withRedis(
    svc: SafeModeService,
    redis: {
      get?: jest.Mock;
      set?: jest.Mock;
      quit?: jest.Mock;
      on?: jest.Mock;
    },
  ): SafeModeService {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (svc as any).redis = redis;
    return svc;
  }

  describe('in-memory mode', () => {
    it('defaults to disabled state', async () => {
      const s = new SafeModeService();
      const state = await s.getState();
      expect(state.enabled).toBe(false);
      expect(state.reason).toBeNull();
      expect(state.updatedByOperatorId).toBeNull();
    });

    it('enable sets the in-memory flag and returns the new state', async () => {
      const s = new SafeModeService();
      const before = (await s.getState()).enabled;
      expect(before).toBe(false);
      const state = await s.enable('op-1', 'drill');
      expect(state.enabled).toBe(true);
      expect(state.reason).toBe('drill');
      expect(state.updatedByOperatorId).toBe('op-1');
      expect((await s.getState()).enabled).toBe(true);
    });

    it('enable uses default reason when reason is omitted', async () => {
      const s = new SafeModeService();
      const state = await s.enable('op-2');
      expect(state.reason).toBe('operator_enabled');
    });

    it('disable resets the in-memory flag and returns the new state', async () => {
      const s = new SafeModeService();
      await s.enable('op-1', 'drill');
      const state = await s.disable('op-1');
      expect(state.enabled).toBe(false);
      expect(state.reason).toBe('operator_disabled');
      expect(state.updatedByOperatorId).toBe('op-1');
      expect((await s.getState()).enabled).toBe(false);
    });

    it('disable uses default reason when reason is omitted', async () => {
      const s = new SafeModeService();
      await s.enable('op-1');
      const state = await s.disable('op-1');
      expect(state.reason).toBe('operator_disabled');
    });

    it('onModuleDestroy is a no-op without a Redis client', async () => {
      const s = new SafeModeService();
      await expect(s.onModuleDestroy()).resolves.toBeUndefined();
    });
  });

  describe('Redis-backed mode', () => {
    it('enable writes JSON payload with no TTL when TTL is 0', async () => {
      const s = new SafeModeService();
      const set = jest.fn().mockResolvedValue('OK');
      withRedis(s, { set });
      const state = await s.enable('op-1', 'manual');
      expect(set).toHaveBeenCalledTimes(1);
      expect(set.mock.calls[0]?.[0]).toBe('arbibot:hermes:safe-mode:v1');
      expect(set.mock.calls[0]?.[1]).toBe(JSON.stringify(state));
      expect(set.mock.calls[0]?.[2]).toBeUndefined();
      // returned state reflects the payload that was written
      expect(state.enabled).toBe(true);
    });

    it('enable writes JSON payload with EX TTL when TTL is set', async () => {
      process.env.HERMES_SAFE_MODE_REDIS_TTL_SECONDS = '300';
      const s = new SafeModeService();
      const set = jest.fn().mockResolvedValue('OK');
      withRedis(s, { set });
      await s.enable('op-1', 'manual');
      expect(set.mock.calls[0]?.[2]).toBe('EX');
      expect(set.mock.calls[0]?.[3]).toBe(300);
    });

    it('enable clamps TTL to the 7-day ceiling (86400 * 7)', async () => {
      process.env.HERMES_SAFE_MODE_REDIS_TTL_SECONDS = '99999999';
      const s = new SafeModeService();
      const set = jest.fn().mockResolvedValue('OK');
      withRedis(s, { set });
      await s.enable('op-1');
      expect(set.mock.calls[0]?.[3]).toBe(86400 * 7);
    });

    it('enable falls back to no-TTL set for non-positive / invalid TTL', async () => {
      process.env.HERMES_SAFE_MODE_REDIS_TTL_SECONDS = '0';
      const s = new SafeModeService();
      const set = jest.fn().mockResolvedValue('OK');
      withRedis(s, { set });
      await s.enable('op-1');
      expect(set.mock.calls[0]?.[2]).toBeUndefined();
    });

    it('enable rethrows when Redis set fails', async () => {
      const s = new SafeModeService();
      const set = jest.fn().mockRejectedValue(new Error('write refused'));
      withRedis(s, { set });
      await expect(s.enable('op-1')).rejects.toThrow('write refused');
    });

    it('disable writes disabled-state payload with no TTL when TTL is 0', async () => {
      const s = new SafeModeService();
      const set = jest.fn().mockResolvedValue('OK');
      withRedis(s, { set });
      const state = await s.disable('op-1', 'all-clear');
      expect(set).toHaveBeenCalledTimes(1);
      expect(set.mock.calls[0]?.[1]).toBe(JSON.stringify(state));
      expect(state.enabled).toBe(false);
      expect(state.reason).toBe('all-clear');
    });

    it('disable writes EX TTL when TTL is set', async () => {
      process.env.HERMES_SAFE_MODE_REDIS_TTL_SECONDS = '120';
      const s = new SafeModeService();
      const set = jest.fn().mockResolvedValue('OK');
      withRedis(s, { set });
      await s.disable('op-1');
      expect(set.mock.calls[0]?.[2]).toBe('EX');
      expect(set.mock.calls[0]?.[3]).toBe(120);
    });

    it('disable rethrows when Redis set fails', async () => {
      const s = new SafeModeService();
      const set = jest.fn().mockRejectedValue(new Error('write refused'));
      withRedis(s, { set });
      await expect(s.disable('op-1')).rejects.toThrow('write refused');
    });

    it('getState reads and parses stored payload from Redis', async () => {
      const s = new SafeModeService();
      const stored = {
        enabled: true,
        updatedAt: '2026-07-17T00:00:00.000Z',
        reason: 'manual',
        updatedByOperatorId: 'op-9',
      };
      withRedis(s, { get: jest.fn().mockResolvedValue(JSON.stringify(stored)) });
      const state = await s.getState();
      expect(state).toEqual(stored);
    });

    it('getState returns empty state when Redis key is missing (null)', async () => {
      const s = new SafeModeService();
      withRedis(s, { get: jest.fn().mockResolvedValue(null) });
      const state = await s.getState();
      expect(state.enabled).toBe(false);
      expect(state.reason).toBeNull();
      expect(state.updatedByOperatorId).toBeNull();
    });

    it('getState returns empty state when Redis key is empty string', async () => {
      const s = new SafeModeService();
      withRedis(s, { get: jest.fn().mockResolvedValue('') });
      const state = await s.getState();
      expect(state.enabled).toBe(false);
    });

    it('getState tolerates explicit-null reason / updatedByOperatorId in payload', async () => {
      const s = new SafeModeService();
      const stored = {
        enabled: true,
        updatedAt: '2026-07-17T00:00:00.000Z',
        reason: null,
        updatedByOperatorId: null,
      };
      withRedis(s, { get: jest.fn().mockResolvedValue(JSON.stringify(stored)) });
      const state = await s.getState();
      expect(state.enabled).toBe(true);
      expect(state.reason).toBeNull();
      expect(state.updatedByOperatorId).toBeNull();
    });

    it('getState falls back to empty-state.updatedAt when payload missing the field', async () => {
      const s = new SafeModeService();
      const stored = { enabled: true }; // no updatedAt / reason / updatedByOperatorId
      withRedis(s, { get: jest.fn().mockResolvedValue(JSON.stringify(stored)) });
      const state = await s.getState();
      expect(state.enabled).toBe(true);
      expect(state.reason).toBeNull();
      expect(state.updatedByOperatorId).toBeNull();
      expect(typeof state.updatedAt).toBe('string');
    });

    it('getState returns empty state when Redis read throws', async () => {
      const s = new SafeModeService();
      withRedis(s, { get: jest.fn().mockRejectedValue(new Error('redis gone')) });
      const state = await s.getState();
      expect(state.enabled).toBe(false);
    });

    it('getState returns empty state when Redis returns non-JSON', async () => {
      const s = new SafeModeService();
      withRedis(s, { get: jest.fn().mockResolvedValue('not-json') });
      const state = await s.getState();
      expect(state.enabled).toBe(false);
    });

    it('onModuleDestroy closes the Redis client', async () => {
      const s = new SafeModeService();
      const quit = jest.fn().mockResolvedValue('OK');
      withRedis(s, { quit });
      await s.onModuleDestroy();
      expect(quit).toHaveBeenCalledTimes(1);
    });
  });

  describe('metrics counter', () => {
    it('exposes getSafeModeRedisErrorsCounter as a singleton on the shared registry', async () => {
      // Trigger one Redis failure to increment the counter, then verify the
      // counter is registered on the shared metrics registry.
      const s = new SafeModeService();
      const set = jest.fn().mockRejectedValue(new Error('redis gone'));
      withRedis(s, { set });
      await expect(s.enable('op-1')).rejects.toThrow('redis gone');
      const reg = getArbibotMetricsRegistry();
      const metric = reg.getSingleMetric('arb_hermes_safe_mode_redis_errors_total');
      expect(metric).toBeDefined();
    });
  });
});
