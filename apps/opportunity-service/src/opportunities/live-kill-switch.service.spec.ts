import { ConflictException } from '@nestjs/common';

import { LiveKillSwitchService } from './live-kill-switch.service';

/**
 * PLAN10 P10-2 — LiveKillSwitchService spec.
 *
 * Verifies the halt-state resolution mirrors DexKillSwitchService.isLiveHalted 1-в-1
 * (so opp-service and execution-orchestrator agree on halt). Critical scenarios:
 * env override branches (`true`/`1` → halt, `false`/`0` → allow, unset → defer),
 * cached config, prod fail-closed, non-prod fail-open.
 */

const ENV_KEYS = [
  'DEX_LIVE_KILL_SWITCH',
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
// private methods via intersection types, which collapse to `never`).
type KillSwitchWithInternals = {
  refresh: () => Promise<void>;
};

describe('LiveKillSwitchService', () => {
  beforeEach(() => {
    clearEnv();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    clearEnv();
  });

  describe('env override (DEX_LIVE_KILL_SWITCH)', () => {
    it("'true' → halt (overrides config)", async () => {
      process.env.DEX_LIVE_KILL_SWITCH = 'true';
      const svc = new LiveKillSwitchService();
      svc.setCacheForTest(false); // config says allow
      expect(await svc.isLiveHalted()).toBe(true); // env wins
    });

    it("'1' → halt (overrides config)", async () => {
      process.env.DEX_LIVE_KILL_SWITCH = '1';
      const svc = new LiveKillSwitchService();
      svc.setCacheForTest(false);
      expect(await svc.isLiveHalted()).toBe(true);
    });

    it("'false' → allow (overrides config)", async () => {
      process.env.DEX_LIVE_KILL_SWITCH = 'false';
      const svc = new LiveKillSwitchService();
      svc.setCacheForTest(true); // config says halt
      expect(await svc.isLiveHalted()).toBe(false); // env wins
    });

    it("'0' → allow (overrides config)", async () => {
      process.env.DEX_LIVE_KILL_SWITCH = '0';
      const svc = new LiveKillSwitchService();
      svc.setCacheForTest(true);
      expect(await svc.isLiveHalted()).toBe(false);
    });

    it('unset → defers to cached config', async () => {
      const svc = new LiveKillSwitchService();
      svc.setCacheForTest(true); // config says halt
      expect(await svc.isLiveHalted()).toBe(true);
      svc.setCacheForTest(false);
      expect(await svc.isLiveHalted()).toBe(false);
    });
  });

  describe('fail-closed / fail-open', () => {
    it('prod + unresolved → halt (fail-closed)', async () => {
      process.env.NODE_ENV = 'production';
      const svc = new LiveKillSwitchService();
      (svc as unknown as KillSwitchWithInternals).refresh = () =>
        Promise.reject(new Error('down'));
      expect(await svc.isLiveHalted()).toBe(true);
    });

    it('non-prod + unresolved → allow (fail-open)', async () => {
      process.env.NODE_ENV = 'development';
      const svc = new LiveKillSwitchService();
      (svc as unknown as KillSwitchWithInternals).refresh = () =>
        Promise.reject(new Error('down'));
      expect(await svc.isLiveHalted()).toBe(false);
    });
  });

  describe('assertLiveNotHalted', () => {
    it('throws ConflictException when halted', async () => {
      process.env.DEX_LIVE_KILL_SWITCH = 'true';
      const svc = new LiveKillSwitchService();
      await expect(svc.assertLiveNotHalted()).rejects.toBeInstanceOf(ConflictException);
    });

    it('resolves when not halted', async () => {
      process.env.DEX_LIVE_KILL_SWITCH = 'false';
      const svc = new LiveKillSwitchService();
      await expect(svc.assertLiveNotHalted()).resolves.toBeUndefined();
    });
  });

  describe('config cache', () => {
    it('cache TTL prevents refetch within window', async () => {
      const svc = new LiveKillSwitchService();
      svc.setCacheForTest(false);
      let calls = 0;
      (svc as unknown as KillSwitchWithInternals).refresh = () => {
        calls += 1;
        return Promise.resolve();
      };
      await svc.isLiveHalted();
      await svc.isLiveHalted();
      expect(calls).toBe(0); // cache fresh, no refetch
    });
  });
});
