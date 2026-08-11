import { Injectable, Logger } from '@nestjs/common';
import { signedFetch } from '@arbibot/nest-platform';

/**
 * PoolFeeClientService (FIX-D, 2026-08-11).
 *
 * Read-only HTTP client to the execution-orchestrator `PoolFeeResolverService`. The
 * opportunity-service needs the most-liquid V3 fee tier for a token pair before building
 * the plan body, replacing the hardcoded `fee: 500` that routed CRV/WETH swaps through a
 * thin pool (~3000× less liquidity than fee=3000) → reverts / ~44× less output.
 *
 * Delegates to `GET /execution/pool/best-fee/:chainId/:tokenA/:tokenB` on EO, which reads
 * `factory.getPool` + `pool.liquidity()` across 4 tiers and returns the highest-liquidity
 * fee. The EO resolver caches per-pair (5 min TTL), so the extra RPC load is bounded.
 *
 * Non-throwing (returns null on any failure) — the caller falls back to
 * `SAFE_DEFAULT_FEE_TIER` (3000) in plan-setup-orchestrator rather than crashing the tick.
 * Mirrors the `LivePriceClientService.getTokenPriceUsd` resilience pattern.
 */

const HTTP_TIMEOUT_MS = 5_000;

@Injectable()
export class PoolFeeClientService {
  private readonly logger = new Logger(PoolFeeClientService.name);

  private readonly executionBaseUrl: string;

  constructor() {
    this.executionBaseUrl = (process.env.EXECUTION_API_BASE ?? 'http://127.0.0.1:3012').replace(
      /\/$/,
      '',
    );
  }

  /**
   * Resolve the V3 fee tier with the highest liquidity for the pair.
   *
   * Returns `null` on any failure (network error, non-OK status, missing/invalid field).
   * The caller falls back to the plan-setup default (3000) — safer than the old hardcoded
   * 500 which selected thin pools for long-tail tokens.
   */
  async getBestFeeTier(
    chainId: number,
    tokenA: string,
    tokenB: string,
  ): Promise<number | null> {
    const url = `${this.executionBaseUrl}/execution/pool/best-fee/${encodeURIComponent(chainId)}/${encodeURIComponent(tokenA)}/${encodeURIComponent(tokenB)}`;
    let res: Response;
    try {
      res = await signedFetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(
        `best-fee lookup failed (chain=${chainId}, ${tokenA}/${tokenB}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
    if (!res.ok) {
      this.logger.warn(
        `best-fee lookup non-OK ${res.status} (chain=${chainId}, ${tokenA}/${tokenB})`,
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
    const fee = (json as Record<string, unknown>).fee;
    if (typeof fee !== 'number' || !Number.isFinite(fee) || fee < 0) {
      return null;
    }
    return fee;
  }
}
