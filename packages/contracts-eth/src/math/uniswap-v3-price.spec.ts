import { v2Price, v3Price, spreadBps, v3PriceRaw } from './uniswap-v3-price';

describe('V3/V2 price math (canonical @arbibot/contracts-eth)', () => {
  describe('v3Price (sqrtPriceX96 → human price)', () => {
    it('returns 1:1 when sqrtPriceX96 = 2^96 (price=1) and equal decimals', () => {
      const sqrtPriceX96 = 2n ** 96n; // sqrt(1) * 2^96
      expect(v3Price(sqrtPriceX96, 18, 18)).toBeCloseTo(1, 8);
    });

    it('returns price=4 when sqrtPriceX96 = 2*2^96 (sqrt(4)=2)', () => {
      const sqrtPriceX96 = 2n * 2n ** 96n;
      expect(v3Price(sqrtPriceX96, 18, 18)).toBeCloseTo(4, 6);
    });

    it('adjusts for decimal difference (WETH 18 / USDC 6)', () => {
      const sqrtPriceX96 = 2n ** 96n; // raw = 1
      expect(v3Price(sqrtPriceX96, 18, 6)).toBeCloseTo(1e12, -2);
      expect(v3Price(sqrtPriceX96, 6, 18)).toBeCloseTo(1e-12, 20);
    });

    it('produces a realistic WETH/USDC price (~2000)', () => {
      const targetUsdcPerWeth = 2000;
      const rawPrice = targetUsdcPerWeth / Math.pow(10, 18 - 6);
      const sqrtRaw = Math.sqrt(rawPrice);
      const q96 = 2n ** 96n;
      const sqrtPriceX96 = BigInt(Math.floor(sqrtRaw * Number(q96)));
      const result = v3Price(sqrtPriceX96, 18, 6);
      expect(result).toBeGreaterThan(1900);
      expect(result).toBeLessThan(2100);
    });
  });

  describe('v3PriceRaw', () => {
    it('returns 1 for sqrtPriceX96 = 2^96', () => {
      expect(v3PriceRaw(2n ** 96n)).toBeCloseTo(1, 8);
    });
  });

  describe('v2Price (reserves → human price)', () => {
    it('returns reserve1/reserve0 adjusted for decimals', () => {
      expect(v2Price(10n ** 18n, 2000n * 10n ** 6n, 18, 6)).toBeCloseTo(2000, 6);
    });

    it('returns 0 when reserve0 is zero (avoid div-by-zero)', () => {
      expect(v2Price(0n, 1000n, 18, 6)).toBe(0);
    });

    it('handles equal decimals', () => {
      expect(v2Price(100n, 250n, 18, 18)).toBeCloseTo(2.5, 8);
    });
  });

  describe('spreadBps', () => {
    it('computes positive spread', () => {
      expect(spreadBps(100, 101)).toBe(100);
    });

    it('returns 0 for non-positive buy price', () => {
      expect(spreadBps(0, 100)).toBe(0);
      expect(spreadBps(-5, 100)).toBe(0);
    });

    it('returns negative spread when sell < buy', () => {
      expect(spreadBps(100, 99)).toBe(-100);
    });

    it('returns 0 for equal prices', () => {
      expect(spreadBps(100, 100)).toBe(0);
    });

    it('handles realistic arb (3 bps = 0.03%)', () => {
      expect(spreadBps(2000, 2000.6)).toBe(3);
    });
  });
});
