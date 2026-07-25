import { ScannerDedupService } from './scanner-dedup.service';
import type { CrossVenueSpread } from './scanner-spread.service';

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

describe('ScannerDedupService', () => {
  const originalEnv = process.env;
  let service: ScannerDedupService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SCANNER_DEDUP_COOLDOWN_MS;
    service = new ScannerDedupService();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('shouldEmit — cooldown window', () => {
    it('emits the first time (no prior emission)', () => {
      expect(service.shouldEmit(makeSpread(), 60_000)).toBe(true);
    });

    it('suppresses a duplicate within the cooldown window', () => {
      service.shouldEmit(makeSpread(), 60_000);
      // Same key, called immediately → within cooldown.
      expect(service.shouldEmit(makeSpread(), 60_000)).toBe(false);
    });

    it('emits again after the cooldown elapses (bypass after expiry)', () => {
      const cooldown = 10;
      service.shouldEmit(makeSpread(), cooldown);
      expect(service.shouldEmit(makeSpread(), cooldown)).toBe(false);
      // Wait past the cooldown.
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(service.shouldEmit(makeSpread(), cooldown)).toBe(true);
          resolve();
        }, cooldown + 20);
      });
    });
  });

  describe('key sensitivity', () => {
    it('different buy venue → different key → emits', () => {
      service.shouldEmit(makeSpread({ buyVenue: 'uniswap-v2' }), 60_000);
      expect(service.shouldEmit(makeSpread({ buyVenue: 'pancakeswap-v2' }), 60_000)).toBe(true);
    });

    it('different sell venue → different key → emits', () => {
      service.shouldEmit(makeSpread({ sellVenue: 'sushiswap' }), 60_000);
      expect(service.shouldEmit(makeSpread({ sellVenue: 'biswap' }), 60_000)).toBe(true);
    });

    it('different canonical token → different key → emits', () => {
      service.shouldEmit(makeSpread({ canonicalToken: '0xUSDC' }), 60_000);
      expect(service.shouldEmit(makeSpread({ canonicalToken: '0xUSDT' }), 60_000)).toBe(true);
    });

    it('same key different chainId → SAME key (cooldown is per token-pair-venue, chain is implicit in token)', () => {
      // Note: the key deliberately omits chainId because the canonical token address is already
      // chain-specific. Two spreads with the same token address but different chainId is not a
      // realistic scenario (addresses don't collide across chains meaningfully here).
      service.shouldEmit(makeSpread({ chainId: 42161 }), 60_000);
      expect(service.shouldEmit(makeSpread({ chainId: 8453 }), 60_000)).toBe(false);
    });
  });

  describe('cooldown resolution', () => {
    it('uses the explicit cooldownMs argument when provided', () => {
      expect(service.shouldEmit(makeSpread(), 1000)).toBe(true);
      expect(service.shouldEmit(makeSpread(), 1000)).toBe(false);
    });

    it('falls back to SCANNER_DEDUP_COOLDOWN_MS env', () => {
      process.env.SCANNER_DEDUP_COOLDOWN_MS = '5';
      expect(service.shouldEmit(makeSpread())).toBe(true);
      expect(service.shouldEmit(makeSpread())).toBe(false);
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(service.shouldEmit(makeSpread())).toBe(true);
          resolve();
        }, 15);
      });
    });
  });

  describe('clear + size', () => {
    it('clear resets all cooldowns', () => {
      service.shouldEmit(makeSpread(), 60_000);
      expect(service.size).toBe(1);
      service.clear();
      expect(service.size).toBe(0);
      expect(service.shouldEmit(makeSpread(), 60_000)).toBe(true);
    });
  });

  describe('resolveCooldownMs — env + override fallback', () => {
    it('uses SCANNER_DEDUP_COOLDOWN_MS env when no override is provided', () => {
      process.env.SCANNER_DEDUP_COOLDOWN_MS = '5000';
      const spread = makeSpread();
      expect(service.shouldEmit(spread)).toBe(true);
      expect(service.shouldEmit(spread)).toBe(false); // suppressed within 5000ms env cooldown
    });

    it('falls back to default when SCANNER_DEDUP_COOLDOWN_MS is invalid (NaN)', () => {
      process.env.SCANNER_DEDUP_COOLDOWN_MS = 'abc';
      const spread = makeSpread();
      expect(service.shouldEmit(spread)).toBe(true);
      expect(service.shouldEmit(spread)).toBe(false); // default 60000 applies
    });

    it('falls back to default when SCANNER_DEDUP_COOLDOWN_MS is negative', () => {
      process.env.SCANNER_DEDUP_COOLDOWN_MS = '-100';
      const spread = makeSpread();
      expect(service.shouldEmit(spread)).toBe(true);
      expect(service.shouldEmit(spread)).toBe(false);
    });

    it('ignores a non-finite override and falls back to env', () => {
      process.env.SCANNER_DEDUP_COOLDOWN_MS = '5000';
      const spread = makeSpread();
      expect(service.shouldEmit(spread, Number.NaN)).toBe(true);
      expect(service.shouldEmit(spread, Number.NaN)).toBe(false);
    });

    it('ignores a negative override and falls back to env', () => {
      process.env.SCANNER_DEDUP_COOLDOWN_MS = '5000';
      const spread = makeSpread();
      expect(service.shouldEmit(spread, -1)).toBe(true);
      expect(service.shouldEmit(spread, -1)).toBe(false);
    });
  });
});
