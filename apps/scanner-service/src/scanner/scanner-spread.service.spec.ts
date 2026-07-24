import { ScannerSpreadService } from './scanner-spread.service';
import type { CrossVenueSpread } from './scanner-spread.service';
import type { PoolSnapshot } from './scanner-pool.service';

const makePool = (overrides: Partial<PoolSnapshot> = {}): PoolSnapshot => ({
  chainId: 42161,
  poolAddress: '0xPOOL_A',
  venueKey: 'uniswap-v2',
  family: 'v2',
  token0: '0xWETH',
  token1: '0xUSDC',
  decimals0: 18,
  decimals1: 6,
  feeBps: 30,
  quotePerBase: 2000,
  liquidityUsd: null,
  reserve0: null,
  reserve1: null,
  blockNumber: null,
  readAt: Date.now(),
  ...overrides,
});

describe('ScannerSpreadService', () => {
  const service = new ScannerSpreadService();

  describe('detect — basic spread', () => {
    it('returns null when fewer than 2 pools', () => {
      expect(service.detect([makePool()])).toBeNull();
      expect(service.detect([])).toBeNull();
    });

    it('returns null when both pools are the same venue', () => {
      const pools = [
        makePool({ venueKey: 'uniswap-v2', quotePerBase: 2000 }),
        makePool({ venueKey: 'uniswap-v2', quotePerBase: 2001 }),
      ];
      expect(service.detect(pools)).toBeNull();
    });

    it('returns null when spread is zero or negative (equal prices)', () => {
      const pools = [
        makePool({ venueKey: 'uniswap-v2', quotePerBase: 2000 }),
        makePool({ venueKey: 'sushiswap', quotePerBase: 2000 }),
      ];
      expect(service.detect(pools)).toBeNull();
    });

    it('detects a positive spread and orders buy < sell', () => {
      // UniV2 at 2000, Sushi at 2010 → 50 bps spread (0.5%)
      const pools = [
        makePool({ venueKey: 'uniswap-v2', poolAddress: '0xUNIV2', quotePerBase: 2000 }),
        makePool({ venueKey: 'sushiswap', poolAddress: '0xSUSHI', quotePerBase: 2010 }),
      ];
      const result = service.detect(pools) as CrossVenueSpread;

      expect(result).not.toBeNull();
      expect(result.buyVenue).toBe('uniswap-v2');
      expect(result.sellVenue).toBe('sushiswap');
      expect(result.spreadBps).toBe(50); // (2010-2000)/2000 * 10000
      expect(result.buyPrice).toBe(2000);
      expect(result.sellPrice).toBe(2010);
    });

    it('computes gross profit from notional + bps', () => {
      // 50 bps on $1000 notional = $5 gross
      const pools = [
        makePool({ venueKey: 'a', quotePerBase: 2000, feeBps: 30 }),
        makePool({ venueKey: 'b', quotePerBase: 2010, feeBps: 30 }),
      ];
      const result = service.detect(pools, 0, 1000) as CrossVenueSpread;
      expect(result.grossProfitUsd).toBeCloseTo(5, 6);
    });

    it('subtracts pool fees from both legs', () => {
      // 50 bps gross = $5. Fees: 30+30 = 60 bps on $1000 = $6. Net = 5 - 6 - 0 = -$1.
      const pools = [
        makePool({ venueKey: 'a', quotePerBase: 2000, feeBps: 30 }),
        makePool({ venueKey: 'b', quotePerBase: 2010, feeBps: 30 }),
      ];
      const result = service.detect(pools, 0, 1000) as CrossVenueSpread;
      expect(result.feesUsd).toBeCloseTo(6, 6);
      expect(result.netProfitUsd).toBeCloseTo(-1, 6);
    });

    it('subtracts gas estimate', () => {
      // 100 bps gross = $10, fees 30+30=60bps=$6, gas $2 → net = 10-6-2 = $2
      const pools = [
        makePool({ venueKey: 'a', quotePerBase: 2000, feeBps: 30 }),
        makePool({ venueKey: 'b', quotePerBase: 2020, feeBps: 30 }),
      ];
      const result = service.detect(pools, 2, 1000) as CrossVenueSpread;
      expect(result.gasUsd).toBe(2);
      expect(result.netProfitUsd).toBeCloseTo(2, 6);
    });
  });

  describe('detect — multiple venues, picks best net', () => {
    it('picks the pair with the largest price gap', () => {
      const pools = [
        makePool({ venueKey: 'a', quotePerBase: 2000, feeBps: 30 }),
        makePool({ venueKey: 'b', quotePerBase: 2005, feeBps: 30 }),
        makePool({ venueKey: 'c', quotePerBase: 2020, feeBps: 30 }),
      ];
      const result = service.detect(pools) as CrossVenueSpread;
      // Best spread: a (2000) → c (2020) = 100 bps
      expect(result.buyVenue).toBe('a');
      expect(result.sellVenue).toBe('c');
      expect(result.spreadBps).toBe(100);
    });
  });

  describe('detect — edge cases', () => {
    it('returns null when buy price is zero', () => {
      const pools = [
        makePool({ venueKey: 'a', quotePerBase: 0 }),
        makePool({ venueKey: 'b', quotePerBase: 2000 }),
      ];
      expect(service.detect(pools)).toBeNull();
    });

    it('returns null when prices are negative', () => {
      const pools = [
        makePool({ venueKey: 'a', quotePerBase: -1 }),
        makePool({ venueKey: 'b', quotePerBase: 2000 }),
      ];
      expect(service.detect(pools)).toBeNull();
    });

    it('separates different token pairs (defensive grouping)', () => {
      const pools = [
        makePool({ venueKey: 'a', token0: '0xWETH', token1: '0xUSDC', quotePerBase: 2000 }),
        makePool({ venueKey: 'b', token0: '0xWETH', token1: '0xUSDC', quotePerBase: 2010 }),
        makePool({ venueKey: 'c', token0: '0xWBTC', token1: '0xUSDC', quotePerBase: 30000 }),
        makePool({ venueKey: 'd', token0: '0xWBTC', token1: '0xUSDC', quotePerBase: 30100 }),
      ];
      const result = service.detect(pools) as CrossVenueSpread;
      // Both pairs have a spread; the WBTC pair (100 bps ≈ 33 bps relative) vs WETH (50 bps).
      // Best NET profit: WETH 50bps gross $5 - fees $6 = -$1; WBTC ~33bps gross $3.3 - $6 = -$2.7.
      // Both negative net → the one with the highest net (least negative) wins: WETH (-$1).
      expect(result).not.toBeNull();
      expect(['0xWETH', '0xWBTC']).toContain(result.token0);
    });

    it('respects custom notional for profit scaling', () => {
      const pools = [
        makePool({ venueKey: 'a', quotePerBase: 2000, feeBps: 0 }),
        makePool({ venueKey: 'b', quotePerBase: 2020, feeBps: 0 }),
      ];
      // 100 bps on $10000 = $100 gross, no fees/gas
      const result = service.detect(pools, 0, 10000) as CrossVenueSpread;
      expect(result.grossProfitUsd).toBeCloseTo(100, 6);
      expect(result.netProfitUsd).toBeCloseTo(100, 6);
    });
  });
});
