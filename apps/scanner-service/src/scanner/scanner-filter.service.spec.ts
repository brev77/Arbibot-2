import { ScannerFilterService } from './scanner-filter.service';
import type { CrossVenueSpread } from './scanner-spread.service';
import type { PoolVolume } from './scanner-volume.service';
import type { ScannerFiltersJson } from './scanner-config.types';

const makeSpread = (overrides: Partial<CrossVenueSpread> = {}): CrossVenueSpread => ({
  chainId: 42161,
  canonicalToken: '0xUSDC',
  token0: '0xWETH',
  token1: '0xUSDC',
  buyVenue: 'uniswap-v2',
  buyPoolAddress: '0xBUY',
  buyPrice: 2000,
  sellVenue: 'sushiswap',
  sellPoolAddress: '0xSELL',
  sellPrice: 2010,
  spreadBps: 50,
  feesUsd: 6,
  gasUsd: 0,
  grossProfitUsd: 5,
  netProfitUsd: 4,
  ...overrides,
});

const makeVolume = (overrides: Partial<PoolVolume> = {}): PoolVolume => ({
  chainId: 42161,
  poolAddress: '0xBUY',
  windowSeconds: 3600,
  volumeUsd: 100_000,
  strategy: 'v3-cumulative',
  ...overrides,
});

describe('ScannerFilterService', () => {
  const service = new ScannerFilterService();

  describe('minSpreadBps', () => {
    it('passes when spread meets threshold', () => {
      const r = service.apply(makeSpread({ spreadBps: 50 }), null, { minSpreadBps: 30 });
      expect(r.passed).toBe(true);
    });

    it('fails when spread below threshold', () => {
      const r = service.apply(makeSpread({ spreadBps: 20 }), null, { minSpreadBps: 30 });
      expect(r.passed).toBe(false);
      expect(r.reason).toBe('minSpreadBps');
    });

    it('skipped when threshold undefined', () => {
      const r = service.apply(makeSpread({ spreadBps: 0 }), null, {});
      expect(r.passed).toBe(true);
    });
  });

  describe('minLiquidityUsd', () => {
    it('passes when netProfitUsd meets threshold', () => {
      const r = service.apply(makeSpread({ netProfitUsd: 100 }), null, { minLiquidityUsd: 50 });
      expect(r.passed).toBe(true);
    });

    it('fails when netProfitUsd below threshold', () => {
      const r = service.apply(makeSpread({ netProfitUsd: 10 }), null, { minLiquidityUsd: 50 });
      expect(r.passed).toBe(false);
      expect(r.reason).toBe('minLiquidityUsd');
    });

    it('treats negative netProfitUsd as 0', () => {
      const r = service.apply(makeSpread({ netProfitUsd: -5 }), null, { minLiquidityUsd: 1 });
      expect(r.passed).toBe(false);
      expect(r.reason).toBe('minLiquidityUsd');
    });
  });

  describe('volumeRange', () => {
    it('skipped when volumeRange.enabled is false (default)', () => {
      const r = service.apply(makeSpread(), null, {
        volumeRange: { enabled: false, min1hUsd: 1000, max24hUsd: 1_000_000 },
      });
      expect(r.passed).toBe(true);
    });

    it('fails when enabled but volume is null (unavailable)', () => {
      const r = service.apply(makeSpread(), null, {
        volumeRange: { enabled: true, min1hUsd: 1000, max24hUsd: 1_000_000 },
      });
      expect(r.passed).toBe(false);
      expect(r.reason).toBe('volumeRange');
    });

    it('fails when volume below min1hUsd', () => {
      const r = service.apply(makeSpread(), makeVolume({ volumeUsd: 500 }), {
        volumeRange: { enabled: true, min1hUsd: 1000, max24hUsd: 1_000_000 },
      });
      expect(r.passed).toBe(false);
      expect(r.reason).toBe('volumeRange');
    });

    it('fails when volume above max24hUsd', () => {
      const r = service.apply(makeSpread(), makeVolume({ volumeUsd: 2_000_000 }), {
        volumeRange: { enabled: true, min1hUsd: 1000, max24hUsd: 1_000_000 },
      });
      expect(r.passed).toBe(false);
      expect(r.reason).toBe('volumeRange');
    });

    it('passes when volume within range', () => {
      const r = service.apply(makeSpread(), makeVolume({ volumeUsd: 50_000 }), {
        volumeRange: { enabled: true, min1hUsd: 1000, max24hUsd: 1_000_000 },
      });
      expect(r.passed).toBe(true);
    });
  });

  describe('blacklistTokens', () => {
    it('fails when canonical token is blacklisted', () => {
      const r = service.apply(makeSpread({ canonicalToken: '0xBAD' }), null, {
        blacklistTokens: ['0xbad'],
      });
      expect(r.passed).toBe(false);
      expect(r.reason).toBe('blacklistTokens');
    });

    it('passes when token not blacklisted (case-insensitive)', () => {
      const r = service.apply(makeSpread({ canonicalToken: '0xGOOD' }), null, {
        blacklistTokens: ['0xBAD'],
      });
      expect(r.passed).toBe(true);
    });

    it('skipped when blacklist empty', () => {
      const r = service.apply(makeSpread(), null, { blacklistTokens: [] });
      expect(r.passed).toBe(true);
    });
  });

  describe('allowedChains', () => {
    it('passes when chain is allowed', () => {
      const r = service.apply(makeSpread({ chainId: 42161 }), null, { allowedChains: [42161, 8453] });
      expect(r.passed).toBe(true);
    });

    it('fails when chain not allowed', () => {
      const r = service.apply(makeSpread({ chainId: 56 }), null, { allowedChains: [42161] });
      expect(r.passed).toBe(false);
      expect(r.reason).toBe('allowedChains');
    });
  });

  describe('quoteAssets', () => {
    it('passes for address-form quote assets matching token1', () => {
      const r = service.apply(makeSpread({ token1: '0xUSDC' }), null, { quoteAssets: ['0xusdc'] });
      expect(r.passed).toBe(true);
    });

    it('passes for symbol-form quote assets (permissive)', () => {
      const r = service.apply(makeSpread({ token1: '0xUSDC' }), null, { quoteAssets: ['USDC'] });
      expect(r.passed).toBe(true);
    });

    it('fails for address-form quote asset not matching', () => {
      const r = service.apply(makeSpread({ token1: '0xUSDC' }), null, { quoteAssets: ['0xOTHER'] });
      expect(r.passed).toBe(false);
      expect(r.reason).toBe('quoteAssets');
    });
  });

  describe('AND-combination', () => {
    it('all filters pass together', () => {
      const filters: ScannerFiltersJson = {
        minSpreadBps: 30,
        minLiquidityUsd: 1,
        volumeRange: { enabled: false },
        blacklistTokens: [],
        allowedChains: [42161],
        quoteAssets: ['USDC'],
      };
      const r = service.apply(makeSpread({ spreadBps: 50, netProfitUsd: 4 }), makeVolume(), filters);
      expect(r.passed).toBe(true);
    });

    it('returns the FIRST failing filter (order: minSpreadBps first)', () => {
      const filters: ScannerFiltersJson = {
        minSpreadBps: 100, // fails first
        allowedChains: [1], // would also fail
      };
      const r = service.apply(makeSpread({ spreadBps: 50 }), null, filters);
      expect(r.passed).toBe(false);
      expect(r.reason).toBe('minSpreadBps');
    });
  });
});
