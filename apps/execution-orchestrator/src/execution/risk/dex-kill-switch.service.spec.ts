import { ConflictException } from '@nestjs/common';

import { DexKillSwitchService } from './dex-kill-switch.service';

/**
 * D4-B-1-KILLSWITCH — unit tests for the live kill-switch.
 *
 * Covers: env override precedence, cached config read, fail-closed in prod,
 * stale-cache retention on fetch failure, assertLiveNotHalted throw/passthrough.
 * Paper/live isolation is exercised at the LegsService level (legs.service.spec).
 */
describe('DexKillSwitchService', () => {
  let service: DexKillSwitchService;
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DEX_LIVE_KILL_SWITCH;
    delete process.env.NODE_ENV;
    // set NODE_ENV to non-production by default so fail-closed doesn't trip
    process.env.NODE_ENV = 'test';
    // Default fetch to a valid killSwitch=false config response.
    (global.fetch as unknown) = jest.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            configValue: JSON.stringify({ killSwitch: false, enabled: false }),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    service = new DexKillSwitchService();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  describe('env override (DEX_LIVE_KILL_SWITCH)', () => {
    it('halts when env is true (overrides config)', async () => {
      service.setCacheForTest(false); // config says not halted
      process.env.DEX_LIVE_KILL_SWITCH = 'true';
      expect(await service.isLiveHalted()).toBe(true);
    });

    it('halts when env is 1', async () => {
      process.env.DEX_LIVE_KILL_SWITCH = '1';
      expect(await service.isLiveHalted()).toBe(true);
    });

    it('does NOT halt when env is false (overrides config true)', async () => {
      service.setCacheForTest(true); // config says halted
      process.env.DEX_LIVE_KILL_SWITCH = 'false';
      expect(await service.isLiveHalted()).toBe(false);
    });

    it('does NOT halt when env is 0 (overrides config true)', async () => {
      service.setCacheForTest(true);
      process.env.DEX_LIVE_KILL_SWITCH = '0';
      expect(await service.isLiveHalted()).toBe(false);
    });

    it('defers to config when env is unset', async () => {
      service.setCacheForTest(true);
      delete process.env.DEX_LIVE_KILL_SWITCH;
      expect(await service.isLiveHalted()).toBe(true);
    });

    it('defers to config when env is garbage (not true/false/1/0)', async () => {
      service.setCacheForTest(true);
      process.env.DEX_LIVE_KILL_SWITCH = 'maybe';
      expect(await service.isLiveHalted()).toBe(true);
    });
  });

  describe('cached config value', () => {
    it('returns cached killSwitch=false', async () => {
      service.setCacheForTest(false);
      expect(await service.isLiveHalted()).toBe(false);
    });

    it('returns cached killSwitch=true', async () => {
      service.setCacheForTest(true);
      expect(await service.isLiveHalted()).toBe(true);
    });
  });

  describe('refresh — config-service fetch', () => {
    it('parses killSwitch=true from configValue JSON string', async () => {
      (global.fetch as unknown) = jest.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              configValue: JSON.stringify({ killSwitch: true }),
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      );
      await service.refresh();
      // After refresh, with no env override, isLiveHalted returns the cached value.
      expect(await service.isLiveHalted()).toBe(true);
    });

    it('defaults killSwitch to false when missing from config JSON', async () => {
      (global.fetch as unknown) = jest.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ configValue: JSON.stringify({ enabled: false }) }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      );
      await service.refresh();
      expect(await service.isLiveHalted()).toBe(false);
    });

    it('retains stale cache on fetch failure (network error)', async () => {
      service.setCacheForTest(true); // pre-existing good value
      (global.fetch as unknown) = jest.fn(() => Promise.reject(new Error('ECONNREFUSED')));
      await service.refresh();
      // Stale cache retained → still halted.
      expect(await service.isLiveHalted()).toBe(true);
    });

    it('retains stale cache on fetch failure (non-200)', async () => {
      service.setCacheForTest(false);
      (global.fetch as unknown) = jest.fn(() =>
        Promise.resolve(new Response('not found', { status: 404 })),
      );
      await service.refresh();
      expect(await service.isLiveHalted()).toBe(false);
    });

    it('retains stale cache on invalid JSON configValue', async () => {
      service.setCacheForTest(true);
      (global.fetch as unknown) = jest.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ configValue: 'not-json{' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      );
      await service.refresh();
      expect(await service.isLiveHalted()).toBe(true);
    });
  });

  describe('fail-closed', () => {
    it('halts in production when cache is empty, no env, and refresh fails', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DEX_LIVE_KILL_SWITCH;
      (global.fetch as unknown) = jest.fn(() =>
        Promise.reject(new Error('ECONNREFUSED')),
      );
      // Fresh service — no cache, refresh will fail.
      const fresh = new DexKillSwitchService();
      expect(await fresh.isLiveHalted()).toBe(true);
    });

    it('allows in non-production when cache is empty and refresh fails', async () => {
      process.env.NODE_ENV = 'development';
      delete process.env.DEX_LIVE_KILL_SWITCH;
      (global.fetch as unknown) = jest.fn(() =>
        Promise.reject(new Error('ECONNREFUSED')),
      );
      const fresh = new DexKillSwitchService();
      expect(await fresh.isLiveHalted()).toBe(false);
    });

    it('env override takes effect even in production with empty cache', async () => {
      process.env.NODE_ENV = 'production';
      process.env.DEX_LIVE_KILL_SWITCH = 'false';
      (global.fetch as unknown) = jest.fn(() =>
        Promise.reject(new Error('ECONNREFUSED')),
      );
      const fresh = new DexKillSwitchService();
      expect(await fresh.isLiveHalted()).toBe(false);
    });
  });

  describe('assertLiveNotHalted', () => {
    it('throws ConflictException when halted', async () => {
      service.setCacheForTest(true);
      await expect(service.assertLiveNotHalted()).rejects.toThrow(ConflictException);
      await expect(service.assertLiveNotHalted()).rejects.toThrow(
        /kill switch active/i,
      );
    });

    it('passes through (no throw) when not halted', async () => {
      service.setCacheForTest(false);
      await expect(service.assertLiveNotHalted()).resolves.toBeUndefined();
    });
  });
});
