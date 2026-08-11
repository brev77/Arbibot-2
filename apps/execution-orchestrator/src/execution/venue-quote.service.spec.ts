/* eslint-disable @typescript-eslint/no-explicit-any */
import { VenueQuoteService } from './venue-quote.service';

const CHAIN = 42161 as never;
const TOKEN0 = '0x000000000000000000000000000000000000aaa1' as never;
const TOKEN1 = '0x000000000000000000000000000000000000bbb2' as never;

function makeMocks() {
  return {
    v3Quoter: { quoteExactInputSingle: jest.fn() },
    v2Quoter: { quoteExactTokensForTokens: jest.fn() },
  };
}

describe('VenueQuoteService', () => {
  let service: VenueQuoteService;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    mocks = makeMocks();
    service = new VenueQuoteService(mocks.v3Quoter as any, mocks.v2Quoter as any);
  });

  describe('quote (routing)', () => {
    it('routes uniswap-v3 to V3QuoterService with the fee tier', async () => {
      mocks.v3Quoter.quoteExactInputSingle.mockResolvedValue(500n);
      const out = await service.quote(CHAIN, 'uniswap-v3', TOKEN1, TOKEN0, 1_000_000n, 3000);
      expect(out).toBe(500n);
      expect(mocks.v3Quoter.quoteExactInputSingle).toHaveBeenCalledWith(
        CHAIN, TOKEN1, TOKEN0, 1_000_000n, 3000,
      );
      expect(mocks.v2Quoter.quoteExactTokensForTokens).not.toHaveBeenCalled();
    });

    it('returns null for uniswap-v3 when fee tier is missing', async () => {
      const out = await service.quote(CHAIN, 'uniswap-v3', TOKEN1, TOKEN0, 1_000_000n);
      expect(out).toBeNull();
    });

    it('routes sushiswap to V2QuoterService', async () => {
      mocks.v2Quoter.quoteExactTokensForTokens.mockResolvedValue(900n);
      const out = await service.quote(CHAIN, 'sushiswap', TOKEN0, TOKEN1, 1_000_000n, 3000);
      expect(out).toBe(900n);
      expect(mocks.v2Quoter.quoteExactTokensForTokens).toHaveBeenCalledWith(
        CHAIN, 'sushiswap', TOKEN0, TOKEN1, 1_000_000n,
      );
      expect(mocks.v3Quoter.quoteExactInputSingle).not.toHaveBeenCalled();
    });

    it('returns null for an unknown venue key', async () => {
      const out = await service.quote(CHAIN, 'balancer', TOKEN0, TOKEN1, 1_000_000n);
      expect(out).toBeNull();
    });
  });

  describe('quoteRoundTrip (chained)', () => {
    it('returns positive roundTripBps when the sell leg yields more than the buy input', async () => {
      // buy: 1e6 token1 -> 2e6 token0 ; sell: 2e6 token0 -> 1.05e6 token1 → +500 bps
      mocks.v3Quoter.quoteExactInputSingle.mockResolvedValue(2_000_000n);
      mocks.v2Quoter.quoteExactTokensForTokens.mockResolvedValue(1_050_000n);
      const rt = await service.quoteRoundTrip({
        chainId: CHAIN, token0: TOKEN0, token1: TOKEN1,
        buyVenue: 'uniswap-v3', sellVenue: 'sushiswap', buyAmountIn: 1_000_000n, feeTier: 3000,
      });
      expect(rt).not.toBeNull();
      expect(rt!.buyOut).toBe(2_000_000n);
      expect(rt!.sellOut).toBe(1_050_000n);
      expect(rt!.roundTripBps).toBe(500);
    });

    it('returns negative roundTripBps for a phantom spread (fees > edge)', async () => {
      // buy 1e6 -> 1e6 ; sell 1e6 -> 0.99e6 → −100 bps
      mocks.v3Quoter.quoteExactInputSingle.mockResolvedValue(1_000_000n);
      mocks.v2Quoter.quoteExactTokensForTokens.mockResolvedValue(990_000n);
      const rt = await service.quoteRoundTrip({
        chainId: CHAIN, token0: TOKEN0, token1: TOKEN1,
        buyVenue: 'uniswap-v3', sellVenue: 'sushiswap', buyAmountIn: 1_000_000n, feeTier: 3000,
      });
      expect(rt).not.toBeNull();
      expect(rt!.roundTripBps).toBe(-100);
    });

    it('passes the fee tier only to the V3 leg (V2 leg ignores it)', async () => {
      mocks.v2Quoter.quoteExactTokensForTokens
        .mockResolvedValueOnce(2_000_000n) // buy on sushiswap
        .mockResolvedValueOnce(1_050_000n); // sell on sushiswap
      const rt = await service.quoteRoundTrip({
        chainId: CHAIN, token0: TOKEN0, token1: TOKEN1,
        buyVenue: 'sushiswap', sellVenue: 'sushiswap', buyAmountIn: 1_000_000n, feeTier: 3000,
      });
      expect(rt).not.toBeNull();
      expect(mocks.v3Quoter.quoteExactInputSingle).not.toHaveBeenCalled();
      expect(mocks.v2Quoter.quoteExactTokensForTokens).toHaveBeenCalledTimes(2);
    });

    it('fails closed (null) when the buy leg quote is null', async () => {
      mocks.v3Quoter.quoteExactInputSingle.mockResolvedValue(null);
      const rt = await service.quoteRoundTrip({
        chainId: CHAIN, token0: TOKEN0, token1: TOKEN1,
        buyVenue: 'uniswap-v3', sellVenue: 'sushiswap', buyAmountIn: 1_000_000n, feeTier: 3000,
      });
      expect(rt).toBeNull();
      expect(mocks.v2Quoter.quoteExactTokensForTokens).not.toHaveBeenCalled();
    });

    it('fails closed (null) when the sell leg quote is null', async () => {
      mocks.v3Quoter.quoteExactInputSingle.mockResolvedValue(2_000_000n);
      mocks.v2Quoter.quoteExactTokensForTokens.mockResolvedValue(null);
      const rt = await service.quoteRoundTrip({
        chainId: CHAIN, token0: TOKEN0, token1: TOKEN1,
        buyVenue: 'uniswap-v3', sellVenue: 'sushiswap', buyAmountIn: 1_000_000n, feeTier: 3000,
      });
      expect(rt).toBeNull();
    });

    it('fails closed (null) when buyAmountIn is non-positive', async () => {
      const rt = await service.quoteRoundTrip({
        chainId: CHAIN, token0: TOKEN0, token1: TOKEN1,
        buyVenue: 'uniswap-v3', sellVenue: 'sushiswap', buyAmountIn: 0n, feeTier: 3000,
      });
      expect(rt).toBeNull();
    });
  });
});
