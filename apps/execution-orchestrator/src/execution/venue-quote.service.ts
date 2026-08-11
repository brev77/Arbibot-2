import { Injectable, Logger } from '@nestjs/common';
import { Address, ChainId } from '@arbibot/contracts-eth';

import { V3QuoterService } from './v3-quoter.service';
import { V2QuoterService, V2_VENUE_KEYS } from './v2-quoter.service';

/**
 * VenueQuoteService — unified, venue-agnostic swap quote (read-only).
 *
 * Routes a quote request by `venueKey`:
 *   - `uniswap-v3` → `V3QuoterService.quoteExactInputSingle` (QuoterV2.staticCall).
 *   - V2 family (`sushiswap` / `uniswap-v2` / `pancakeswap-v2` / `biswap`) →
 *     `V2QuoterService.quoteExactTokensForTokens` (router.getAmountsOut).
 *
 * The primary consumer is the round-trip profitability gate (P1): the
 * opportunity-service `LiveAutoDriveWorker` calls `quoteRoundTrip` to measure the
 * HONEST cross-DEX round-trip (buy venue quote → sell venue quote, chained with a
 * consistent amount) before any plan is created or capital reserved. This kills
 * the phantom-spread opportunities that the scanner emits from stale mid-prices.
 *
 * Capital safety: every underlying call is a read-only view (`eth_call`); no
 * broadcast. Any failure resolves to `null` so the gate fails closed.
 */
@Injectable()
export class VenueQuoteService {
  private readonly logger = new Logger(VenueQuoteService.name);

  constructor(
    private readonly v3Quoter: V3QuoterService,
    private readonly v2Quoter: V2QuoterService,
  ) {}

  /**
   * Quote a single-hop swap `tokenIn → tokenOut` on the given venue.
   *
   * @param fee V3 fee tier (uint24); required for `uniswap-v3`, ignored for V2.
   * @returns realized `amountOut` (bigint) or `null` on any failure / unknown venue.
   */
  async quote(
    chainId: ChainId,
    venueKey: string,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    fee?: number,
  ): Promise<bigint | null> {
    if (venueKey === 'uniswap-v3') {
      if (fee === undefined) {
        return null;
      }
      return this.v3Quoter.quoteExactInputSingle(chainId, tokenIn, tokenOut, amountIn, fee);
    }
    if (V2_VENUE_KEYS.has(venueKey)) {
      return this.v2Quoter.quoteExactTokensForTokens(chainId, venueKey, tokenIn, tokenOut, amountIn);
    }
    return null;
  }

  /**
   * Quote a full cross-DEX round-trip and return the net in basis points.
   *
   * Direction matches the plan: the arb BUYS the base token (token0) with the
   * quote token (token1) on `buyVenue`, then SELLS the received token0 back to
   * token1 on `sellVenue`. Both quotes are at the same trade size (the sell
   * amountIn is the buy amountOut), so the round-trip is an apples-to-apples
   * measure of realizable profit — NOT a mid-price snapshot.
   *
   * Pool fees are already deducted by both quote primitives (QuoterV2 and
   * getAmountsOut return post-fee outputs), so `roundTripBps` is net of pool
   * fees. It does NOT include gas (that stays the EO cost-gate's job as the
   * second layer). A value `<= 0` means the spread is a phantom (fees exceed the
   * cross-venue edge) and the opportunity must be rejected.
   *
   * @returns `{ buyOut, sellOut, roundTripBps }`, or `null` if either leg cannot
   *   be quoted (fail-closed — the caller skips rather than guessing).
   */
  async quoteRoundTrip(args: {
    readonly chainId: ChainId;
    readonly token0: Address; // base token (the arb's leg asset)
    readonly token1: Address; // quote token (in/out on both legs, e.g. WETH)
    readonly buyVenue: string;
    readonly sellVenue: string;
    readonly buyAmountIn: bigint; // amount of token1 spent on the buy leg
    readonly feeTier?: number; // V3 fee tier (applies to whichever leg is V3)
  }): Promise<{ buyOut: bigint; sellOut: bigint; roundTripBps: number } | null> {
    const { chainId, token0, token1, buyVenue, sellVenue, buyAmountIn, feeTier } = args;
    if (buyAmountIn <= 0n) {
      return null;
    }
    // Leg 0 (buy): token1 → token0 on buyVenue.
    const buyFee = buyVenue === 'uniswap-v3' ? feeTier : undefined;
    const buyOut = await this.quote(chainId, buyVenue, token1, token0, buyAmountIn, buyFee);
    if (buyOut === null || buyOut <= 0n) {
      return null;
    }
    // Leg 1 (sell): token0 → token1 on sellVenue, chaining the buy output.
    const sellFee = sellVenue === 'uniswap-v3' ? feeTier : undefined;
    const sellOut = await this.quote(chainId, sellVenue, token0, token1, buyOut, sellFee);
    if (sellOut === null || sellOut <= 0n) {
      return null;
    }
    // roundTripBps = (sellOut − buyAmountIn) / buyAmountIn × 10000 (raw; can be negative).
    const roundTripBps = Number(((sellOut - buyAmountIn) * 10_000n) / buyAmountIn);
    return { buyOut, sellOut, roundTripBps };
  }
}
