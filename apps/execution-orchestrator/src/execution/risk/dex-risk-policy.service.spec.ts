import type { Repository } from 'typeorm';

import { DexDailyVolumeEntity } from '@arbibot/persistence';

import { DexRiskPolicyService } from './dex-risk-policy.service';

/**
 * D4-B-2-LIMITS (sub-step 2a) — unit tests for DexRiskPolicyService:
 * config-service parsing, env lower-bound overrides, DB-backed daily volume,
 * evaluateTrade block/allow decisions.
 */
describe('DexRiskPolicyService', () => {
  let service: DexRiskPolicyService;
  let volumeRepo: { findOne: jest.Mock; query: jest.Mock };
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DEX_MAX_SLIPPAGE_BPS;
    delete process.env.DEX_MAX_POSITION_SIZE_USD;
    delete process.env.DEX_MIN_POOL_LIQUIDITY_USD;

    volumeRepo = {
      findOne: jest.fn(() => Promise.resolve(null)),
      query: jest.fn(() => Promise.resolve([])),
    };

    // Default fetch: valid dex.limits with killSwitch=false, modest caps.
    (global.fetch as unknown) = jest.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            configValue: JSON.stringify({
              enabled: true,
              maxNotionalPerTradeUsd: 500,
              maxDailyNotionalUsd: 5000,
              maxSlippageBps: 50,
              killSwitch: false,
              requireOperatorApprovalPerTrade: true,
            }),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    service = new DexRiskPolicyService(
      volumeRepo as unknown as Repository<DexDailyVolumeEntity>,
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  describe('getEffectiveConfig — config-service parsing', () => {
    it('parses dex.limits effective and returns the config', async () => {
      const cfg = await service.getEffectiveConfig();
      expect(cfg.enabled).toBe(true);
      expect(cfg.maxPositionSizeUsd).toBe(500);
      expect(cfg.maxDailyVolumeUsd).toBe(5000);
      expect(cfg.maxSlippageBps).toBe(50);
      expect(cfg.requireApproval).toBe(true);
    });

    it('keeps all 5 protocols allowed by default', async () => {
      const cfg = await service.getEffectiveConfig();
      expect(cfg.allowedProtocols).toEqual(
        expect.arrayContaining([
          'uniswap-v2',
          'uniswap-v3',
          'sushiswap',
          'pancakeswap-v2',
          'biswap',
        ]),
      );
    });

    it('falls back to safe defaults when config-service is unreachable', async () => {
      (global.fetch as unknown) = jest.fn(() => Promise.reject(new Error('ECONNREFUSED')));
      const fresh = new DexRiskPolicyService(
        volumeRepo as unknown as Repository<DexDailyVolumeEntity>,
      );
      const cfg = await fresh.getEffectiveConfig();
      // Safe defaults: enabled false, minimal caps.
      expect(cfg.enabled).toBe(false);
      expect(cfg.maxDailyVolumeUsd).toBe(5_000);
    });

    it('retains stale cache on fetch failure', async () => {
      // First call populates cache.
      await service.getEffectiveConfig();
      // Second call with failing fetch should retain cache.
      (global.fetch as unknown) = jest.fn(() => Promise.reject(new Error('down')));
      const cfg = await service.getEffectiveConfig();
      expect(cfg.enabled).toBe(true);
      expect(cfg.maxPositionSizeUsd).toBe(500);
    });
  });

  describe('getEffectiveConfig — env lower-bound overrides', () => {
    it('env tightens slippage (lower wins)', async () => {
      process.env.DEX_MAX_SLIPPAGE_BPS = '20'; // config says 50 → 20 wins
      const cfg = await service.getEffectiveConfig();
      expect(cfg.maxSlippageBps).toBe(20);
    });

    it('env does NOT loosen slippage (config wins if lower)', async () => {
      process.env.DEX_MAX_SLIPPAGE_BPS = '999'; // config says 50 → 50 stays
      const cfg = await service.getEffectiveConfig();
      expect(cfg.maxSlippageBps).toBe(50);
    });

    it('env tightens position size (lower wins)', async () => {
      process.env.DEX_MAX_POSITION_SIZE_USD = '100'; // config says 500 → 100 wins
      const cfg = await service.getEffectiveConfig();
      expect(cfg.maxPositionSizeUsd).toBe(100);
    });

    it('env raises min liquidity bar (higher wins for liquidity)', async () => {
      process.env.DEX_MIN_POOL_LIQUIDITY_USD = '200000';
      const cfg = await service.getEffectiveConfig();
      expect(cfg.minPoolLiquidityUsd).toBeGreaterThanOrEqual(200_000);
    });
  });

  describe('recordTradeVolume — DB UPSERT', () => {
    it('issues an atomic INSERT ... ON CONFLICT UPSERT', async () => {
      await service.recordTradeVolume(42161, 42.5);
      expect(volumeRepo.query).toHaveBeenCalledTimes(1);
      const [sql, params] = volumeRepo.query.mock.calls[0]!;
      expect(sql).toMatch(/ON CONFLICT \(chain_id, for_date\) DO UPDATE/);
      expect(sql).toMatch(/volume_usd = dex_daily_volume\.volume_usd \+ EXCLUDED\.volume_usd/);
      expect(params[0]).toBe(42161);
      expect(params[2]).toBe(42.5);
    });

    it('skips zero / negative volume', async () => {
      await service.recordTradeVolume(42161, 0);
      await service.recordTradeVolume(42161, -5);
      expect(volumeRepo.query).not.toHaveBeenCalled();
    });

    it('does not throw when the DB write fails (non-fatal)', async () => {
      volumeRepo.query = jest.fn(() => Promise.reject(new Error('DB down')));
      await expect(service.recordTradeVolume(42161, 10)).resolves.toBeUndefined();
    });
  });

  describe('evaluateTrade — block / allow decisions', () => {
    it('allows a trade within all limits', async () => {
      service.setLimitsCacheForTest({
        enabled: true,
        maxSlippageBps: 100,
        maxPositionSizeUsd: 1000,
        minPoolLiquidityUsd: 0,
        maxGasPriceGwei: 50,
        allowedProtocols: ['uniswap-v2'],
        blockedTokens: [],
        maxDailyVolumeUsd: 10_000,
        requireApproval: false,
      });
      const result = await service.evaluateTrade({
        chainId: 42161,
        amountInUsd: 100,
        estimatedSlippageBps: 30,
        estimatedGasCostUsd: 0,
        tokenIn: '0x0000000000000000000000000000000000000001',
        tokenOut: '0x0000000000000000000000000000000000000002',
      });
      expect(result.allowed).toBe(true);
      expect(result.reasons).toEqual([]);
    });

    it('blocks when position size exceeds maxNotionalPerTradeUsd', async () => {
      service.setLimitsCacheForTest({
        enabled: true,
        maxSlippageBps: 100,
        maxPositionSizeUsd: 100,
        minPoolLiquidityUsd: 0,
        maxGasPriceGwei: 50,
        allowedProtocols: ['uniswap-v2'],
        blockedTokens: [],
        maxDailyVolumeUsd: 10_000,
        requireApproval: false,
      });
      const result = await service.evaluateTrade({
        chainId: 42161,
        amountInUsd: 500,
        estimatedSlippageBps: 30,
        estimatedGasCostUsd: 0,
        tokenIn: '0x0000000000000000000000000000000000000001',
        tokenOut: '0x0000000000000000000000000000000000000002',
      });
      expect(result.allowed).toBe(false);
      expect(result.reasons.some((r) => r.includes('exceeds max'))).toBe(true);
    });

    it('blocks when daily volume would exceed maxDailyNotionalUsd', async () => {
      service.setLimitsCacheForTest({
        enabled: true,
        maxSlippageBps: 100,
        maxPositionSizeUsd: 10_000,
        minPoolLiquidityUsd: 0,
        maxGasPriceGwei: 50,
        allowedProtocols: ['uniswap-v2'],
        blockedTokens: [],
        maxDailyVolumeUsd: 1000,
        requireApproval: false,
      });
      // Existing daily volume 950; adding 100 → 1050 > 1000.
      volumeRepo.findOne = jest.fn(() => Promise.resolve({ volumeUsd: '950' }));
      const result = await service.evaluateTrade({
        chainId: 42161,
        amountInUsd: 100,
        estimatedSlippageBps: 30,
        estimatedGasCostUsd: 0,
        tokenIn: '0x0000000000000000000000000000000000000001',
        tokenOut: '0x0000000000000000000000000000000000000002',
      });
      expect(result.allowed).toBe(false);
      expect(result.reasons.some((r) => r.includes('Daily volume'))).toBe(true);
    });

    it('blocks when slippage exceeds maxSlippageBps', async () => {
      service.setLimitsCacheForTest({
        enabled: true,
        maxSlippageBps: 50,
        maxPositionSizeUsd: 10_000,
        minPoolLiquidityUsd: 0,
        maxGasPriceGwei: 50,
        allowedProtocols: ['uniswap-v2'],
        blockedTokens: [],
        maxDailyVolumeUsd: 10_000,
        requireApproval: false,
      });
      const result = await service.evaluateTrade({
        chainId: 42161,
        amountInUsd: 50,
        estimatedSlippageBps: 200,
        estimatedGasCostUsd: 0,
        tokenIn: '0x0000000000000000000000000000000000000001',
        tokenOut: '0x0000000000000000000000000000000000000002',
      });
      expect(result.allowed).toBe(false);
      expect(result.reasons.some((r) => r.includes('Slippage'))).toBe(true);
    });

    it('blocks when a token is in blockedTokens', async () => {
      const blocked = '0xdead000000000000000000000000000000000000';
      service.setLimitsCacheForTest({
        enabled: true,
        maxSlippageBps: 100,
        maxPositionSizeUsd: 10_000,
        minPoolLiquidityUsd: 0,
        maxGasPriceGwei: 50,
        allowedProtocols: ['uniswap-v2'],
        blockedTokens: [blocked],
        maxDailyVolumeUsd: 10_000,
        requireApproval: false,
      });
      const result = await service.evaluateTrade({
        chainId: 42161,
        amountInUsd: 50,
        estimatedSlippageBps: 10,
        estimatedGasCostUsd: 0,
        tokenIn: blocked,
        tokenOut: '0x0000000000000000000000000000000000000002',
      });
      expect(result.allowed).toBe(false);
      expect(result.reasons.some((r) => r.includes('blocked token'))).toBe(true);
    });
  });

  describe('getEffectiveLiveConfig', () => {
    it('parses dex.live effective (chains as string array → number[])', async () => {
      (global.fetch as unknown) = jest.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              configValue: JSON.stringify({
                liveEnabled: true,
                paperParallelEnabled: false,
                chains: ['42161', '8453'],
                dryRunMode: false,
              }),
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        ),
      );
      const live = await service.getEffectiveLiveConfig();
      expect(live.liveEnabled).toBe(true);
      expect(live.chains).toEqual([42161, 8453]);
      expect(live.dryRunMode).toBe(false);
    });

    it('falls back to safe live defaults (liveEnabled false) when unreachable', async () => {
      (global.fetch as unknown) = jest.fn(() => Promise.reject(new Error('down')));
      const fresh = new DexRiskPolicyService(
        volumeRepo as unknown as Repository<DexDailyVolumeEntity>,
      );
      const live = await fresh.getEffectiveLiveConfig();
      expect(live.liveEnabled).toBe(false);
      expect(live.dryRunMode).toBe(true);
    });
  });
});
