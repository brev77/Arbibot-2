import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import type { DiscoveredPool } from '../pool/pool-discovery.service';

import { SlippageProtectionService } from './slippage-protection.service';

/**
 * SlippageProtectionService spec (DEX-1-1-SLIPPAGE).
 *
 * Pattern A: direct instantiation. Service has no DI deps — only metrics
 * (registered on shared registry via getArbibotMetricsRegistry()).
 */
describe('SlippageProtectionService', () => {
  let svc: SlippageProtectionService;

  const mkPool = (over: Partial<DiscoveredPool> = {}): DiscoveredPool => ({
    address: '0xpool1',
    token0: '0xtokena',
    token1: '0xtokenb',
    feeBps: 30,
    reserve0: 1_000_000n * 10n ** 18n,
    reserve1: 2_000_000n * 10n ** 18n,
    chainId: 1,
    factory: '0xfactory',
    protocol: 'uniswap-v2',
    blockNumber: 100,
    discoveredAt: new Date(),
    ...over,
  });

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
    svc = new SlippageProtectionService();
  });

  describe('estimateSlippage', () => {
    it('computes price impact using token0 as input', () => {
      const pool = mkPool();
      const result = svc.estimateSlippage({
        pool,
        amountIn: 10n * 10n ** 18n, // 10 units into 1M reserve
        tokenIn: '0xtokena',
        chainId: 1,
      });

      // priceImpact = (10 * 10000) / (1000000 + 10) ≈ 0 (rounded to 0 bigint)
      // poolImpact = priceImpact + feeBps(30) = 30
      expect(result.estimatedBps).toBeGreaterThanOrEqual(30);
      expect(result.maxAcceptableBps).toBe(100); // default
      expect(result.poolImpactBps).toBeGreaterThanOrEqual(30);
      expect(result.priceImpactBps).toBeGreaterThanOrEqual(0);
      expect(result.isAcceptable).toBe(true);
      expect(result.recommendation).toBe('proceed');
    });

    it('uses token1 as input when tokenIn matches token1', () => {
      const pool = mkPool({ reserve0: 100n, reserve1: 200n });
      const result = svc.estimateSlippage({
        pool,
        amountIn: 10n,
        tokenIn: '0xTOKENB', // case-insensitive match on token1
        chainId: 1,
      });

      // reserveIn = reserve1 = 200; priceImpact = (10*10000)/(200+10) = 476
      expect(result.priceImpactBps).toBeGreaterThan(0);
      expect(result.estimatedBps).toBe(result.priceImpactBps + pool.feeBps);
    });

    it('returns zero impact when reserveIn is 0', () => {
      const pool = mkPool({ reserve0: 0n, reserve1: 0n });
      const result = svc.estimateSlippage({
        pool,
        amountIn: 100n,
        tokenIn: '0xtokena',
        chainId: 1,
      });

      expect(result.priceImpactBps).toBe(0);
      expect(result.estimatedBps).toBe(pool.feeBps);
    });

    it('respects custom maxSlippageBps', () => {
      const pool = mkPool();
      const result = svc.estimateSlippage({
        pool,
        amountIn: 10n * 10n ** 18n,
        tokenIn: '0xtokena',
        chainId: 1,
        maxSlippageBps: 10, // very tight
      });

      expect(result.maxAcceptableBps).toBe(10);
      // poolImpact >= 30 (fee), so > maxBps=10 → not acceptable, reduce_size or abort
      expect(result.isAcceptable).toBe(false);
      expect(['reduce_size', 'abort']).toContain(result.recommendation);
    });

    it('recommends reduce_size when estimated exceeds maxBps (but not 2x)', () => {
      const pool = mkPool({ feeBps: 0, reserve0: 1000n, reserve1: 1000n });
      // amountIn=200 → impact = 200*10000/1200 ≈ 1666
      const result = svc.estimateSlippage({
        pool,
        amountIn: 200n,
        tokenIn: '0xtokena',
        chainId: 1,
        maxSlippageBps: 1000, // max=1000, estimated~1666 < 2*1000=2000 → reduce_size
      });

      expect(result.estimatedBps).toBeGreaterThan(1000);
      expect(result.estimatedBps).toBeLessThan(2000);
      expect(result.recommendation).toBe('reduce_size');
      expect(result.isAcceptable).toBe(false);
    });

    it('recommends abort when estimated exceeds 2x maxBps', () => {
      const pool = mkPool({ feeBps: 0, reserve0: 100n, reserve1: 100n });
      // amountIn=1000 → impact = 1000*10000/1100 ≈ 9090
      const result = svc.estimateSlippage({
        pool,
        amountIn: 1000n,
        tokenIn: '0xtokena',
        chainId: 1,
        maxSlippageBps: 100, // max=100, estimated~9090 > 2*100=200 → abort
      });

      expect(result.estimatedBps).toBeGreaterThan(200);
      expect(result.recommendation).toBe('abort');
      expect(result.isAcceptable).toBe(false);
    });

    it('recommends proceed when estimated exceeds WARNING_THRESHOLD but stays within max', () => {
      const pool = mkPool({ feeBps: 0, reserve0: 1000n, reserve1: 1000n });
      // amountIn=10 → impact = 10*10000/1010 ≈ 99 (>50 warning threshold, <=100 max)
      const result = svc.estimateSlippage({
        pool,
        amountIn: 10n,
        tokenIn: '0xtokena',
        chainId: 1,
        maxSlippageBps: 100,
      });

      expect(result.estimatedBps).toBeGreaterThan(50);
      expect(result.estimatedBps).toBeLessThanOrEqual(100);
      expect(result.recommendation).toBe('proceed');
      expect(result.isAcceptable).toBe(true);
    });
  });

  describe('calculateMaxTradeAmount', () => {
    it('solves for amountIn from the constant-product inverse', () => {
      const pool = mkPool({ reserve0: 1000n, reserve1: 1000n });
      // amountIn = (1000 * 100) / (10000 - 100) = 100000/9900 ≈ 10
      const result = svc.calculateMaxTradeAmount({
        pool,
        tokenIn: '0xtokena',
        maxSlippageBps: 100,
      });

      expect(result).toBe((1000n * 100n) / 9900n);
    });

    it('uses reserve1 when tokenIn matches token1', () => {
      const pool = mkPool({ reserve0: 100n, reserve1: 500n });
      const result = svc.calculateMaxTradeAmount({
        pool,
        tokenIn: '0xTOKENB', // case-insensitive
        maxSlippageBps: 100,
      });

      expect(result).toBe((500n * 100n) / 9900n);
    });

    it('returns reserveIn when maxBps >= 10000 (no limit)', () => {
      const pool = mkPool({ reserve0: 777n, reserve1: 999n });
      const result = svc.calculateMaxTradeAmount({
        pool,
        tokenIn: '0xtokena',
        maxSlippageBps: 10000,
      });

      expect(result).toBe(777n);
    });

    it('returns reserveIn when maxBps > 10000 (no limit)', () => {
      const pool = mkPool({ reserve0: 1234n, reserve1: 5678n });
      const result = svc.calculateMaxTradeAmount({
        pool,
        tokenIn: '0xtokena',
        maxSlippageBps: 50000,
      });

      expect(result).toBe(1234n);
    });

    it('uses default maxBps when omitted', () => {
      const pool = mkPool({ reserve0: 1000n, reserve1: 1000n });
      const withDefault = svc.calculateMaxTradeAmount({
        pool,
        tokenIn: '0xtokena',
      });
      const withExplicit = svc.calculateMaxTradeAmount({
        pool,
        tokenIn: '0xtokena',
        maxSlippageBps: 100,
      });

      expect(withDefault).toBe(withExplicit);
    });
  });
});
