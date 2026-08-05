import { TokenResolverService, parseInstrumentKey } from './token-resolver.service';

/**
 * PLAN10 P10-3 — TokenResolverService spec.
 *
 * Covers: instrumentKey parsing (address pair + ticker pair), ticker→address mapping for
 * staples (WETH/USDC/USDT), pre-quoted amountIn calc (Модель #1), fail-closed on unknown
 * token / missing price / malformed key. The reverted-sell risk is documented (Модель #1
 * accepted for MVP; recovery tested in P10-8).
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

  describe('address-pair resolution', () => {
    it('resolves address pair verbatim (Arbitrum mainnet chain)', () => {
      const magic = '0x539bde0d7c7a39d0b4873a3e75e4bb56b1b58442';
      const usdc = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
      // Long-tail base address (MAGIC typo) → decimals unresolvable → null.
      const r = svc.resolve(`arb:42161:${magic}-${usdc}`, 10, { buyPrice: 0.5 });
      expect(r).toBeNull();
    });

    it('resolves a known long-tail address pair (fix #2: KNOWN_DECIMALS_BY_ADDRESS)', () => {
      // Real MAGIC address — in KNOWN_DECIMALS_BY_ADDRESS (18 decimals).
      const magic = '0x539bde0d7dbd336b79148aa742883198bbf60342';
      const usdc = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
      const r = svc.resolve(`arb:42161:${magic}-${usdc}`, 10, { buyPrice: 0.04 });
      expect(r).not.toBeNull();
      expect(r!.tokens.decimals0).toBe(18); // MAGIC
      expect(r!.tokens.decimals1).toBe(6); // USDC
      // buy: $10 USDC = 10_000_000
      expect(r!.amountIns.buyAmountIn).toBe('10000000');
      // sell: 10/0.04 = 250 MAGIC * 10^18 = 250_000_000_000_000_000_000
      expect(r!.amountIns.sellAmountIn).toBe('250000000000000000000');
    });

    it('resolves a WBTC pair with 8-decimal known address', () => {
      const wbtc = '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f';
      const weth = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
      const r = svc.resolve(`arb:42161:${wbtc}-${weth}`, 10, { buyPrice: 15 });
      expect(r).not.toBeNull();
      expect(r!.tokens.decimals0).toBe(8); // WBTC
      expect(r!.tokens.decimals1).toBe(18); // WETH
    });
  });

  describe('ticker-pair resolution (staples)', () => {
    it('resolves WETH-USDC on Arbitrum mainnet + computes amountIns', () => {
      const r = svc.resolve('arb:42161:WETH-USDC', 10, { buyPrice: 2000 });
      expect(r).not.toBeNull();
      // token0=WETH (18), token1=USDC (6)
      expect(r!.tokens.decimals0).toBe(18);
      expect(r!.tokens.decimals1).toBe(6);
      expect(r!.tokens.chainId).toBe(42161);
      // buy: $10 USDC = 10 * 10^6 = 10_000_000
      expect(r!.amountIns.buyAmountIn).toBe('10000000');
      // sell: 10/2000 = 0.005 WETH * 10^18 = 5_000_000_000_000_000
      expect(r!.amountIns.sellAmountIn).toBe('5000000000000000');
    });

    it('returns null on testnet chain (PLAN10 scope: mainnet only)', () => {
      // 421614 (Sepolia) not in MVP address-book switch — single-chain mainnet scope.
      const r = svc.resolve('arb:421614:WETH-USDC', 5, { buyPrice: 2000 });
      expect(r).toBeNull();
    });

    it('returns null on non-staple ticker (long-tail token)', () => {
      const r = svc.resolve('arb:42161:MAGIC-USDC', 10, { buyPrice: 0.5 });
      expect(r).toBeNull(); // MAGIC not in WETH/USDC/USDT staples
    });

    it('returns null on unknown chain', () => {
      const r = svc.resolve('arb:99999:WETH-USDC', 10, { buyPrice: 2000 });
      expect(r).toBeNull();
    });
  });

  describe('amountIn calc (Модель #1)', () => {
    it('returns null when evidence.buyPrice is missing', () => {
      const r = svc.resolve('arb:42161:WETH-USDC', 10, undefined);
      expect(r).toBeNull();
    });

    it('returns null when evidence.buyPrice is zero/negative', () => {
      const r = svc.resolve('arb:42161:WETH-USDC', 10, { buyPrice: 0 });
      expect(r).toBeNull();
    });

    it('returns null when notional is zero', () => {
      const r = svc.resolve('arb:42161:WETH-USDC', 0, { buyPrice: 2000 });
      expect(r).toBeNull();
    });

    it('computes correct sell amountIn for USDC-quoted token at price 0.5', () => {
      // WETH-USDC inverted isn't right for this; use a hypothetical where price=0.5 means
      // 0.5 USDC per WETH-wei is nonsensical, but the math is what we test.
      // For WETH-USDC at buyPrice=0.5: 10 USDC / 0.5 = 20 WETH * 10^18
      const r = svc.resolve('arb:42161:WETH-USDC', 10, { buyPrice: 0.5 });
      expect(r).not.toBeNull();
      expect(r!.amountIns.buyAmountIn).toBe('10000000'); // 10 USDC (6 dec)
      expect(r!.amountIns.sellAmountIn).toBe('20000000000000000000'); // 20 WETH (18 dec)
    });
  });

  describe('malformed input', () => {
    it('returns null on empty key', () => {
      expect(svc.resolve('', 10, { buyPrice: 1 })).toBeNull();
    });
    it('returns null on non-string key', () => {
      expect(svc.resolve(null as unknown as string, 10, { buyPrice: 1 })).toBeNull();
    });
  });
});
