import { Controller, Get, Query } from '@nestjs/common';
import { Address } from '@arbibot/contracts-eth';

import { VenueQuoteService } from './venue-quote.service';

/**
 * Round-trip quote result envelope. `ok:false` signals the round-trip could not
 * be priced (fail-soft); the caller skips the opportunity rather than guessing.
 */
export interface RoundTripQuoteResponse {
  readonly chainId: number;
  readonly token0: string;
  readonly token1: string;
  readonly buyVenue: string;
  readonly sellVenue: string;
  readonly buyAmountIn: string;
  readonly ok: boolean;
  readonly buyOut?: string;
  readonly sellOut?: string;
  /** Net basis points of the chained round-trip (net of pool fees; excludes gas). */
  readonly roundTripBps?: number;
}

/**
 * Quote Controller (P1, 2026-08-11).
 *
 * Read-only endpoint exposing `VenueQuoteService.quoteRoundTrip` to peer
 * services. The primary consumer is the opportunity-service
 * `LiveAutoDriveWorker`, which uses the honest cross-DEX round-trip to reject
 * phantom-spread opportunities BEFORE a plan is created or capital reserved —
 * replacing the stale mid-price spread that let unprofitable arbs reach the
 * funded live wallet.
 *
 * No auth guard — matches every other EO controller (platform-level HTTP only).
 * `ok:false` (HTTP 200) on any quote failure so the caller fails closed; the
 * endpoint never throws on quote errors.
 */
@Controller('execution/quote')
export class QuoteController {
  constructor(private readonly venueQuote: VenueQuoteService) {}

  @Get('round-trip')
  async roundTrip(
    @Query('chainId') chainIdQ: string,
    @Query('token0') token0: Address,
    @Query('token1') token1: Address,
    @Query('buyVenue') buyVenue: string,
    @Query('sellVenue') sellVenue: string,
    @Query('buyAmountIn') buyAmountInQ: string,
    @Query('feeTier') feeTierQ?: string,
  ): Promise<RoundTripQuoteResponse> {
    const chainId = Number(chainIdQ);
    const base = {
      chainId,
      token0: token0.toLowerCase(),
      token1: token1.toLowerCase(),
      buyVenue,
      sellVenue,
      buyAmountIn: buyAmountInQ,
    };
    let buyAmountIn: bigint;
    try {
      buyAmountIn = BigInt(buyAmountInQ);
    } catch {
      return { ...base, ok: false };
    }
    const feeTier = feeTierQ !== undefined && feeTierQ.length > 0 ? Number(feeTierQ) : undefined;
    const rt = await this.venueQuote.quoteRoundTrip({
      chainId,
      token0,
      token1,
      buyVenue,
      sellVenue,
      buyAmountIn,
      ...(feeTier !== undefined && Number.isFinite(feeTier) ? { feeTier } : {}),
    });
    if (rt === null) {
      return { ...base, ok: false };
    }
    return {
      ...base,
      ok: true,
      buyOut: rt.buyOut.toString(),
      sellOut: rt.sellOut.toString(),
      roundTripBps: rt.roundTripBps,
    };
  }
}
