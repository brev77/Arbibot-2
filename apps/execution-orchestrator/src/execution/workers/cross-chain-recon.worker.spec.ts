import type { CrossChainReconciliationService } from '../reconciliation/cross-chain-reconciliation.service';

import { CrossChainReconWorker } from './cross-chain-recon.worker';

/**
 * CrossChainReconWorker spec (DEX-2-3-RECON-XCHAIN).
 *
 * Pattern: direct instantiation with a mock CrossChainReconciliationService.
 * Worker has no DI deps beyond the service; onModuleInit / onModuleDestroy
 * behaviour is straightforward to exercise directly.
 */
describe('CrossChainReconWorker', () => {
  const origEnv = process.env;

  let reconServiceMock: { runFullReconciliation: jest.Mock };
  let worker: CrossChainReconWorker;

  beforeEach(() => {
    process.env = { ...origEnv };
    delete process.env.CROSS_CHAIN_RECON_ENABLED;
    delete process.env.CROSS_CHAIN_RECON_INTERVAL_MS;
    delete process.env.CROSS_CHAIN_RECON_STALE_MS;
    reconServiceMock = {
      runFullReconciliation: jest.fn(),
    };
    worker = new CrossChainReconWorker(
      reconServiceMock as unknown as CrossChainReconciliationService,
    );
  });

  afterAll(() => {
    process.env = origEnv;
  });

  describe('onModuleInit', () => {
    it('skips timer when CROSS_CHAIN_RECON_ENABLED not set', () => {
      worker.onModuleInit();
      // timer is private; verify via side-effect (runOnce path untouched)
      expect((worker as unknown as { timer?: NodeJS.Timeout }).timer).toBeUndefined();
    });

    it('skips timer when CROSS_CHAIN_RECON_ENABLED != "true"', () => {
      process.env.CROSS_CHAIN_RECON_ENABLED = 'false';
      worker.onModuleInit();
      expect((worker as unknown as { timer?: NodeJS.Timeout }).timer).toBeUndefined();
    });

    it('starts timer when CROSS_CHAIN_RECON_ENABLED=true', () => {
      process.env.CROSS_CHAIN_RECON_ENABLED = 'true';
      process.env.CROSS_CHAIN_RECON_INTERVAL_MS = '9999';
      process.env.CROSS_CHAIN_RECON_STALE_MS = '12345';
      worker.onModuleInit();
      expect((worker as unknown as { timer?: NodeJS.Timeout }).timer).toBeDefined();
      worker.onModuleDestroy();
    });

    it('uses default interval/stale when env vars are unset', () => {
      process.env.CROSS_CHAIN_RECON_ENABLED = 'true';
      worker.onModuleInit();
      expect((worker as unknown as { intervalMs: number }).intervalMs).toBe(60_000);
      expect((worker as unknown as { staleThresholdMs: number }).staleThresholdMs).toBe(1_800_000);
      worker.onModuleDestroy();
    });

    it('honours custom interval/stale from env', () => {
      process.env.CROSS_CHAIN_RECON_ENABLED = 'true';
      process.env.CROSS_CHAIN_RECON_INTERVAL_MS = '5000';
      process.env.CROSS_CHAIN_RECON_STALE_MS = '60000';
      const w = new CrossChainReconWorker(
        reconServiceMock as unknown as CrossChainReconciliationService,
      );
      w.onModuleInit();
      expect((w as unknown as { intervalMs: number }).intervalMs).toBe(5000);
      expect((w as unknown as { staleThresholdMs: number }).staleThresholdMs).toBe(60000);
      w.onModuleDestroy();
    });
  });

  describe('onModuleDestroy', () => {
    it('clears the timer when set', () => {
      process.env.CROSS_CHAIN_RECON_ENABLED = 'true';
      process.env.CROSS_CHAIN_RECON_INTERVAL_MS = '999999';
      worker.onModuleInit();
      expect((worker as unknown as { timer?: NodeJS.Timeout }).timer).toBeDefined();

      worker.onModuleDestroy();
      expect((worker as unknown as { timer?: NodeJS.Timeout }).timer).toBeUndefined();
    });

    it('is a no-op when no timer was scheduled', () => {
      expect(() => worker.onModuleDestroy()).not.toThrow();
      expect((worker as unknown as { timer?: NodeJS.Timeout }).timer).toBeUndefined();
    });
  });

  describe('runOnce', () => {
    it('forwards staleThresholdMs and returns reconciliation summary', async () => {
      reconServiceMock.runFullReconciliation.mockResolvedValue({
        totalMismatches: 3,
        totalStale: 1,
        healthy: false,
      });

      const result = await worker.runOnce();

      expect(reconServiceMock.runFullReconciliation).toHaveBeenCalledWith(1_800_000);
      expect(result).toEqual({ mismatches: 3, stale: 1, healthy: false });
    });

    it('returns healthy=true when recon reports healthy', async () => {
      reconServiceMock.runFullReconciliation.mockResolvedValue({
        totalMismatches: 0,
        totalStale: 0,
        healthy: true,
      });

      const result = await worker.runOnce();

      expect(result).toEqual({ mismatches: 0, stale: 0, healthy: true });
    });

    it('returns zeroed unhealthy summary when reconService throws Error', async () => {
      reconServiceMock.runFullReconciliation.mockRejectedValue(new Error('boom'));

      const result = await worker.runOnce();

      expect(result).toEqual({ mismatches: 0, stale: 0, healthy: false });
    });

    it('returns zeroed unhealthy summary when reconService throws non-Error', async () => {
      reconServiceMock.runFullReconciliation.mockRejectedValue('string-err');

      const result = await worker.runOnce();

      expect(result).toEqual({ mismatches: 0, stale: 0, healthy: false });
    });
  });
});
