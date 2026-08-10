import { Injectable, Logger } from '@nestjs/common';
import { signedFetch } from '@arbibot/nest-platform';

/**
 * LivePriceClientService (PLAN12 #48 — `FUNC-AMOUNTIN-USD-ORACLE`).
 *
 * Read-only HTTP client to the execution-orchestrator `PriceOracleService`. The
 * opportunity-service needs the USD price of the quote token (token1) to convert
 * `notionalUsd` into correct `amountIn` raw units. Previously `TokenResolverService`
 * assumed every quote token was a $1 stablecoin (`notionalUsd × 10^decimals1`), which
 * generated catastrophic amounts for WETH-quoted pairs (50 × 10^18 = 50 WETH ≈ $130k
 * for a $50 notional — capital-safety RED-zone).
 *
 * Delegates to `GET /execution/price/:chainId/:tokenAddress` on EO, which wraps the
 * existing 3-tier `PriceOracleService` (stables → $1, WETH/WBNB → Chainlink, long-tail
 * → token↔WETH pool derivation). The oracle's 60s in-memory cache + single-flight mean
 * the additional RPC load for ~1 opp/min is negligible after the first read per token.
 *
 * Non-throwing (returns null on any failure) — the worker skips the opportunity with a
 * `skip_no_price` metric label rather than crashing the tick. Mirrors the
 * `RiskClientService.getRiskDecision` resilience pattern.
 */

/** Read-only price lookups are lightweight; a short timeout fails fast rather than
 * hanging the worker tick when EO is slow/unreachable. */
const HTTP_TIMEOUT_MS = 5_000;

@Injectable()
export class LivePriceClientService {
  private readonly logger = new Logger(LivePriceClientService.name);

  private readonly executionBaseUrl: string;

  constructor() {
    this.executionBaseUrl = (process.env.EXECUTION_API_BASE ?? 'http://127.0.0.1:3012').replace(
      /\/$/,
      '',
    );
  }

  /**
   * Resolve a token's USD price via the EO PriceOracleService.
   *
   * Returns `null` on any failure (network error, non-OK status, missing field) or when
   * the oracle itself cannot price the token (fail-closed). The caller MUST treat null as
   * "cannot value the quote leg" and skip plan creation — never fall back to the old
   * `notionalUsd × 10^decimals` formula (that path is the bug this service closes).
   */
  async getTokenPriceUsd(chainId: number, tokenAddress: string): Promise<number | null> {
    const url = `${this.executionBaseUrl}/execution/price/${encodeURIComponent(chainId)}/${encodeURIComponent(tokenAddress)}`;
    let res: Response;
    try {
      res = await signedFetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      // Network error or timeout — treat as transient; caller skips (skip_no_price).
      this.logger.warn(
        `price lookup failed (chain=${chainId}, token=${tokenAddress}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
    if (!res.ok) {
      this.logger.warn(
        `price lookup non-OK ${res.status} (chain=${chainId}, token=${tokenAddress})`,
      );
      return null;
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text.length > 0 ? (JSON.parse(text) as unknown) : null;
    } catch {
      return null;
    }
    if (json === null || typeof json !== 'object') {
      return null;
    }
    const priceUsd = (json as Record<string, unknown>).priceUsd;
    if (typeof priceUsd !== 'number' || !Number.isFinite(priceUsd) || priceUsd <= 0) {
      // Oracle returned null or an unusable value — fail-closed.
      return null;
    }
    return priceUsd;
  }
}
