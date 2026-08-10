import { TokenResolverService, parseInstrumentKey } from './token-resolver.service';

/**
 * PLAN10 P10-3 / PLAN12 #48 — TokenResolverService spec.
 *
 * PLAN12 #48 split `resolve()` into `resolveTokens()` (sync, pure) + `computeAmountIns()`
 * (sync, now takes `quoteUsd`), so the async oracle lookup can happen between them.
 *
 * Covers: instrumentKey parsing (address pair + ticker pair), ticker→address mapping for
 * staples (WETH/USDC/USDT), USD-aware amountIn calc (Модель #1), fail-closed on unknown
 * token / missing price / malformed key / missing quoteUsd. The reverted-sell risk is
 * documented (Модель #1 accepted for MVP; recovery tested in P10-8).
 */

describe('parseInstrumentKey', () => {
  it('parses address pair', () => {
    const key = 'arb:42161:0x539bde0d7c7a39d0b4873a3e75e4bb56b1b58442-0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
    expect(parseInstrumentKey(key)).toEqual({
      chainId: 42161,
      left: '0x539bde0d7c7a39d0b4873a3e75e4bb56b1b58442',
      right: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    });
  });

  it('parses ticker pair', () => {
    expect(parseInstrumentKey('arb:42161:WETH-USDC')).toEqual({
      chainId: 42161,
      left: 'WETH',
      right: 'USDC',
    });
  });

  it('returns null on malformed key (missing venue)', () => {
    expect(parseInstrumentKey('42161:WETH-USDC')).toBeNull();
  });

  it('returns null on non-arb venue', () => {
    expect(parseInstrumentKey('base:8453:WETH-USDC')).toBeNull();
  });

  it('returns null on missing dash', () => {
    expect(parseInstrumentKey('arb:42161:WETHUSDC')).toBeNull();
  });
});

describe('TokenResolverService', () => {
  const svc = new TokenResolverService();

  describe('address-pair resolution (resolveTokens)', () => {
    it('resolves a known long-tail address pair (fix #2: KNOWN_DECIMALS_BY_ADDRESS)', () => {
      // Real MAGIC address — in KNOWN_DECIMALS_BY_ADDRESS (18 decimals).
      const magic = '0x539bde0d7dbd336b79148aa742883198bbf60342';
      const usdc = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
      const t = svc.resolveTokens(`arb:42161:${magic}-${usdc}`);
      expect(t).not.toBeNull();
      expect(t!.decimals0).toBe(18); // MAGIC
      expect(t!.decimals1).toBe(6); // USDC
      expect(t!.token0Address).toBe(magic);
      expect(t!.token1Address).toBe(usdc);
      expect(t!.chainId).toBe(42161);
    });

    it('resolves a WBTC pair with 8-decimal known address', () => {
      const wbtc = '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f';
      const weth = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
      const t = svc.resolveTokens(`arb:42161:${wbtc}-${weth}`);
      expect(t).not.toBeNull();
      expect(t!.decimals0).toBe(8); // WBTC
      expect(t!.decimals1).toBe(18); // WETH
    });

    it('returns null on unknown long-tail address (not in KNOWN_DECIMALS_BY_ADDRESS)', () => {
      const unknown = '0x539bde0d7c7a39d0b4873a3e75e4bb56b1b58442'; // not the real MAGIC
      const usdc = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
      expect(svc.resolveTokens(`arb:42161:${unknown}-${usdc}`)).toBeNull();
    });
  });

  describe('ticker-pair resolution (resolveTokens)', () => {
    it('resolves WETH-USDC on Arbitrum mainnet', () => {
      const t = svc.resolveTokens('arb:42161:WETH-USDC');
      expect(t).not.toBeNull();
      // token0=WETH (18), token1=USDC (6)
      expect(t!.decimals0).toBe(18);
      expect(t!.decimals1).toBe(6);
      expect(t!.chainId).toBe(42161);
    });

    it('returns null on testnet chain (PLAN10 scope: mainnet only)', () => {
      // 421614 (Sepolia) not in MVP address-book switch — single-chain mainnet scope.
      expect(svc.resolveTokens('arb:421614:WETH-USDC')).toBeNull();
    });

    it('returns null on non-staple ticker (long-tail token)', () => {
      expect(svc.resolveTokens('arb:42161:MAGIC-USDC')).toBeNull(); // MAGIC not in staples
    });

    it('returns null on unknown chain', () => {
      expect(svc.resolveTokens('arb:99999:WETH-USDC')).toBeNull();
    });
  });

  describe('malformed input (resolveTokens)', () => {
    it('returns null on empty key', () => {
      expect(svc.resolveTokens('')).toBeNull();
    });
    it('returns null on non-string key', () => {
      expect(svc.resolveTokens(null as unknown as string)).toBeNull();
    });
  });

  describe('amountIn calc — USD-aware (PLAN12 #48, Модель #1)', () => {
    // A canonical stable-quoted pair used across cases: token0=WETH (18), token1=USDC (6).
    const wethUsdc = {
      token0Address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
      token1Address: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
      decimals0: 18,
      decimals1: 6,
      chainId: 42161,
    };
    // CRV/WETH — token0=CRV (18), token1=WETH (18). The pair that exposed the bug in
    // production (scanner found buyPrice=0.000122 WETH per CRV).
    const crvWeth = {
      token0Address: '0x11cdb42b0eb46d95f990bedd4695a6e3fa034978',
      token1Address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
      decimals0: 18,
      decimals1: 18,
      chainId: 42161,
    };

    it('stable-quoted: quoteUsd=1 reduces to the legacy formula (backward compat)', () => {
      // $10 USDC notional, WETH at 2000 USDC/WETH.
      const r = svc.computeAmountIns(wethUsdc, 10, { buyPrice: 2000 }, 1);
      expect(r).not.toBeNull();
      // buy: $10 / $1 = 10 USDC human → 10 × 10^6 = 10_000_000
      expect(r!.buyAmountIn).toBe('10000000');
      // sell: 10 / 2000 = 0.005 WETH → 5_000_000_000_000_000
      expect(r!.sellAmountIn).toBe('5000000000000000');
    });

    it('WETH-quoted: $50 notional converts to ~0.019 WETH (NOT 50 WETH)', () => {
      // Production bug proof: $50 notional, WETH at $2600, CRV buyPrice 0.000122 WETH/CRV.
      // OLD (buggy) formula would yield buyAmountIn = 50 × 10^18 = 50 WETH ($130k).
      // NEW formula: 50 / 2600 = 0.019230... WETH.
      const r = svc.computeAmountIns(crvWeth, 50, { buyPrice: 0.000122 }, 2600);
      expect(r).not.toBeNull();
      const buyWeth = Number(r!.buyAmountIn) / 1e18;
      // ~0.0192 WETH, well under 1 WETH — confirms the fix.
      expect(buyWeth).toBeLessThan(0.02);
      expect(buyWeth).toBeGreaterThan(0.019);
      // sell: 0.0192307 / 0.000122 ≈ 157.6 CRV → ~157 × 10^18
      const sellCrv = Number(r!.sellAmountIn) / 1e18;
      expect(sellCrv).toBeGreaterThan(150);
      expect(sellCrv).toBeLessThan(165);
    });

    it('WETH-quoted: exact buyAmountIn value for $50 @ $2600', () => {
      const r = svc.computeAmountIns(crvWeth, 50, { buyPrice: 0.000122 }, 2600);
      expect(r).not.toBeNull();
      // 50/2600 = 0.019230769... × 10^18. IEEE-754 double precision yields ...232 in the
      // last digits (not the textbook ...230) — the value is correct to ~15 significant
      // figures, which is far tighter than any DEX amount needs.
      expect(r!.buyAmountIn).toBe('19230769230769232');
    });

    it('returns null when quoteUsd is zero (fail-closed)', () => {
      expect(svc.computeAmountIns(wethUsdc, 10, { buyPrice: 2000 }, 0)).toBeNull();
    });

    it('returns null when quoteUsd is negative (fail-closed)', () => {
      expect(svc.computeAmountIns(wethUsdc, 10, { buyPrice: 2000 }, -1)).toBeNull();
    });

    it('returns null when quoteUsd is NaN (fail-closed)', () => {
      expect(svc.computeAmountIns(wethUsdc, 10, { buyPrice: 2000 }, NaN)).toBeNull();
    });

    it('returns null when notional is zero', () => {
      expect(svc.computeAmountIns(wethUsdc, 0, { buyPrice: 2000 }, 1)).toBeNull();
    });

    it('returns null when evidence.buyPrice is missing', () => {
      expect(svc.computeAmountIns(wethUsdc, 10, undefined, 1)).toBeNull();
    });

    it('returns null when evidence.buyPrice is zero/negative', () => {
      expect(svc.computeAmountIns(wethUsdc, 10, { buyPrice: 0 }, 1)).toBeNull();
    });
  });
});
