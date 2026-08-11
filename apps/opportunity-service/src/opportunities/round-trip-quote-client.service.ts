import { Injectable, Logger } from '@nestjs/common';
import { signedFetch } from '@arbibot/nest-platform';

/**
 * RoundTripQuoteClientService (P1, 2026-08-11).
 *
 * Read-only HTTP client to the execution-orchestrator `VenueQuoteService`.
 * The opportunity-service needs the HONEST cross-DEX round-trip (two chained
 * venue quotes at a consistent trade size) before building a plan, to reject
 * phantom-spread opportunities the scanner emits from stale mid-prices (P0
 * showed every liquid Arbitrum pair has a negative real round-trip).
 *
 * Delegates to `GET /execution/quote/round-trip` on EO, which calls
 * `QuoterV2.staticCall` / `router.getAmountsOut` for both legs and returns the
 * net basis points (already net of pool fees). opp-service is RPC-less by design
 * (capital safety: keys and broadcast live only in EO), so quotes go over HTTP.
 *
 * Non-throwing (returns null on any failure — network error, non-OK / `ok:false`
 * body, missing/invalid field). The caller (LiveAutoDriveWorker) treats null as
 * `skip_no_quote` — fail-closed: a missing quote must NEVER fall through to the
 * old mid-price path (that would re-open the phantom-spread hole).
 */
const HTTP_TIMEOUT_MS = 5_000;

@Injectable()
export class RoundTripQuoteClientService {
  private readonly logger = new Logger(RoundTripQuoteClientService.name);

  private readonly executionBaseUrl: string;

  constructor() {
    this.executionBaseUrl = (process.env.EXECUTION_API_BASE ?? 'http://127.0.0.1:3012').replace(
      /\/$/,
      '',
    );
  }

  /**
   * Evaluate the honest cross-DEX round-trip for an opportunity.
   *
   * @returns `{ roundTripBps, buyOut, sellOut }` on success, or `null` when the
   *   round-trip cannot be priced (RPC down, unsupported venue/chain, no
   *   liquidity). Never throws.
   */
  async evaluateRoundTrip(args: {
    readonly chainId: number;
    readonly token0: string;
    readonly token1: string;
    readonly buyVenue: string;
    readonly sellVenue: string;
    readonly buyAmountIn: string;
    readonly feeTier?: number;
  }): Promise<{ roundTripBps: number; buyOut: string; sellOut: string } | null> {
    const url = new URL(`${this.executionBaseUrl}/execution/quote/round-trip`);
    url.searchParams.set('chainId', String(args.chainId));
    url.searchParams.set('token0', args.token0);
    url.searchParams.set('token1', args.token1);
    url.searchParams.set('buyVenue', args.buyVenue);
    url.searchParams.set('sellVenue', args.sellVenue);
    url.searchParams.set('buyAmountIn', args.buyAmountIn);
    if (args.feeTier !== undefined) {
      url.searchParams.set('feeTier', String(args.feeTier));
    }

    let res: Response;
    try {
      res = await signedFetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(
        `round-trip quote failed (chain=${args.chainId}, ${args.buyVenue}/${args.sellVenue}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
    if (!res.ok) {
      this.logger.warn(
        `round-trip quote non-OK ${res.status} (chain=${args.chainId}, ${args.buyVenue}/${args.sellVenue})`,
      );
      return null;
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      return null;
    }
    if (json === null || typeof json !== 'object') {
      return null;
    }
    const body = json as Record<string, unknown>;
    // EO returns ok:false when a leg could not be quoted — treat as fail-closed.
    if (body.ok !== true) {
      return null;
    }
    const roundTripBps = body.roundTripBps;
    const buyOut = body.buyOut;
    const sellOut = body.sellOut;
    if (
      typeof roundTripBps !== 'number' ||
      !Number.isFinite(roundTripBps) ||
      typeof buyOut !== 'string' ||
      typeof sellOut !== 'string'
    ) {
      return null;
    }
    return { roundTripBps, buyOut, sellOut };
  }
}
