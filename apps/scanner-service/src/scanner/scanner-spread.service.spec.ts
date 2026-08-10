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

  describe('multi-pair grouping', () => {
    it('skips a pair with only one pool and returns a spread from the populated pair', () => {
      const pools = [
        // Pair A: WETH-USDC with two venues → spread detectable.
        makePool({ venueKey: 'uniswap-v2', quotePerBase: 2000 }),
        makePool({ venueKey: 'sushiswap', quotePerBase: 2010 }),
        // Pair B: WBTC-USDC with a single pool → skipped (< 2 pools).
        makePool({ token0: '0xWBTC', venueKey: 'uniswap-v2', quotePerBase: 40000 }),
      ];
      const result = service.detect(pools);
      expect(result).not.toBeNull();
      // The returned spread must be from the WETH-USDC pair (the populated one).
      expect((result as CrossVenueSpread).token0).toBe('0xWETH');
      expect((result as CrossVenueSpread).buyVenue).toBe('uniswap-v2');
      expect((result as CrossVenueSpread).sellVenue).toBe('sushiswap');
    });

    it('returns null when every pair has only a single pool', () => {
      const pools = [
        makePool({ token0: '0xA', venueKey: 'uniswap-v2' }),
        makePool({ token0: '0xB', venueKey: 'uniswap-v2' }),
      ];
      expect(service.detect(pools)).toBeNull();
    });
  });

  describe('detect — dead-pool filter (PLAN13 #2)', () => {
    // A healthy V2 pool: 1 WETH (1e18) reserve × $2000 = $2000 + 2000 USDC (2e9) × $1.
    // reserve0 = base (WETH), reserve1 = quote (USDC). quotePerBase = USDC per WETH = 2000.
    const healthyV2 = (overrides: Partial<PoolSnapshot> = {}): PoolSnapshot =>
      makePool({
        venueKey: 'sushiswap',
        family: 'v2',
        token0: '0xWETH',
        token1: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC (Arbitrum, lowercase-checked later)
        decimals0: 18,
        decimals1: 6,
        quotePerBase: 2000,
        reserve0: 1_000_000_000_000_000_000n, // 1 WETH
        reserve1: 2_000_000_000n, // 2000 USDC
        ...overrides,
      });
    // A dead V2 pool: 0.001 WETH + 0.5 USDC ≈ $2.50 liquidity.
    const deadV2 = (overrides: Partial<PoolSnapshot> = {}): PoolSnapshot =>
      healthyV2({
        venueKey: 'sushiswap-dead',
        poolAddress: '0xDEAD',
        reserve0: 1_000_000_000_000_000n, // 0.001 WETH
        reserve1: 500_000n, // 0.5 USDC
        quotePerBase: 500, // anomalous cheap price from the tiny reserves
        ...overrides,
      });

    it('excludes a V2 pool below the liquidity threshold before buy/sell selection', () => {
      // Without the filter the dead pool's anomalous price (500) would dominate the spread.
      // With the filter it is dropped, so no spread forms against the dead pool.
      const pools = [healthyV2({ quotePerBase: 2000 }), deadV2({ quotePerBase: 500 })];
      // minPoolLiquidityUsd=500, quoteUsd=1 (USDC quote). healthy ~$4000, dead ~$2.50.
      const result = service.detect(pools, 0, 1000, 500, 1);
      // Only one pool survives → null (cannot form a 2-venue spread).
      expect(result).toBeNull();
    });

    it('keeps both pools when both are above the threshold', () => {
      const pools = [
        healthyV2({ venueKey: 'a', quotePerBase: 2000 }),
        healthyV2({ venueKey: 'b', poolAddress: '0xB', quotePerBase: 2010 }),
      ];
      const result = service.detect(pools, 0, 1000, 500, 1);
      expect(result).not.toBeNull();
      expect((result as CrossVenueSpread).spreadBps).toBeGreaterThan(0);
    });

    it('exempts V3 pools from the reserve threshold (their reserves are liquidity, not TVL)', () => {
      // A V3 pool with "reserves" (actually liquidity) that would fail the threshold if treated as V2.
      const v3 = healthyV2({
        family: 'v3',
        venueKey: 'uniswap-v3',
        reserve0: 0n,
        reserve1: 0n,
        quotePerBase: 1990,
      });
      const pools = [healthyV2({ venueKey: 'sushiswap', quotePerBase: 2000 }), v3];
      const result = service.detect(pools, 0, 1000, 500, 1);
      // V3 is exempt → spread forms between V2 and V3.
      expect(result).not.toBeNull();
    });

    it('is OFF when minPoolLiquidityUsd is undefined (backward-compat)', () => {
      const pools = [healthyV2({ quotePerBase: 2000 }), deadV2({ quotePerBase: 500 })];
      // No threshold → dead pool participates, anomalous spread forms.
      const result = service.detect(pools);
      expect(result).not.toBeNull();
    });

    it('is OFF when quoteUsd is 0 (no native price configured, fail-open)', () => {
      const pools = [healthyV2({ quotePerBase: 2000 }), deadV2({ quotePerBase: 500 })];
      // WETH quote but nativeUsd=0 → cannot price V2 reserves → filter no-op.
      const result = service.detect(pools, 0, 1000, 500, 0);
      expect(result).not.toBeNull();
    });
  });

  describe('computePoolLiquidityUsd (PLAN13 #1)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { computePoolLiquidityUsd } = require('./scanner-spread.service') as {
      computePoolLiquidityUsd: (p: PoolSnapshot, quoteUsd: number) => number | null;
    };

    it('returns null for V3 pools (reserves are liquidity, not real)', () => {
      const v3 = makePool({ family: 'v3', reserve0: 1000n, reserve1: 1000n });
      expect(computePoolLiquidityUsd(v3, 2000)).toBeNull();
    });

    it('prices a USDC-quoted V2 pool at quoteUsd=1', () => {
      // 1 WETH reserve × quotePerBase 2000 = 2000 USDC worth of base; + 2000 USDC reserve = 4000 USDC.
      const pool = makePool({
        family: 'v2',
        decimals0: 18,
        decimals1: 6,
        quotePerBase: 2000,
        reserve0: 1_000_000_000_000_000_000n,
        reserve1: 2_000_000_000n,
      });
      expect(computePoolLiquidityUsd(pool, 1)).toBeCloseTo(4000, 0);
    });

    it('prices a WETH-quoted V2 pool using the native USD price', () => {
      // Same reserves but quoteUsd=$2000 → 4000 USDC × $2000 = $8,000,000. (Synthetic test for math.)
      const pool = makePool({
        family: 'v2',
        decimals0: 18,
        decimals1: 6,
        quotePerBase: 2000,
        reserve0: 1_000_000_000_000_000_000n,
        reserve1: 2_000_000_000n,
      });
      expect(computePoolLiquidityUsd(pool, 2000)).toBeCloseTo(8_000_000, -5);
    });

    it('returns 0 when reserves are null (defensive — treated as illiquid)', () => {
      const pool = makePool({ family: 'v2', reserve0: null, reserve1: null });
      expect(computePoolLiquidityUsd(pool, 2000)).toBe(0);
    });

    it('returns 0 when quoteUsd is 0 (cannot price)', () => {
      const pool = makePool({
        family: 'v2',
        reserve0: 1_000_000_000_000_000_000n,
        reserve1: 2_000_000_000n,
      });
      expect(computePoolLiquidityUsd(pool, 0)).toBe(0);
    });
  });
});
