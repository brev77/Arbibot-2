/**
 * Uniswap V3 / V2 price math — canonical, shared implementation.
 *
 * Lives in `@arbibot/contracts-eth` so both `scanner-service` (spread detection)
 * and `execution-orchestrator` (PriceOracle live valuation) read from one source.
 * Previously the V3 math existed only in `scanner-service/src/scanner/v3-price.ts`;
 * the execution-orchestrator's `PoolDiscoveryService` instead dumped `liquidity`
 * into both `reserve0`/`reserve1`, which is mathematically meaningless as a price,
 * and `PriceOracleService` returned `null` for every V3 pool — blocking any V3-only
 * token (e.g. MAGIC) at the live cost gate. See
 * `docs/plan-hermes-live-correctness-2026-08-06.md` (#45 FUNC-V3-PRICING).
 *
 * The V3 pool price is encoded in `slot0.sqrtPriceX96` as the square root of the
 * token1/token0 ratio, scaled by 2^96:
 *   sqrtPrice = sqrtPriceX96 / 2^96
 *   price (token1 per token0, raw units) = sqrtPrice² = (sqrtPriceX96 / 2^96)²
 *
 * To express it in human units we then divide by 10^(decimals0 - decimals1):
 *   priceHuman (token1 per token0) = priceRaw × 10^(decimals0 - decimals1)
 *
 * All functions return the token1-per-token0 price. Callers swap direction by
 * inverting (1/price).
 */

const Q96 = 2n ** 96n;

/**
 * Compute the raw (unscaled) token1-per-token0 price from sqrtPriceX96.
 * `price = (sqrtPriceX96 / 2^96)² = sqrtPriceX96² / 2^192`.
 * Uses BigInt with 1e18 scaling to avoid float precision loss on the huge values.
 */
export function v3PriceRaw(sqrtPriceX96: bigint): number {
  const numerator = sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n;
  const denominator = Q96 * Q96; // 2^192
  // scaledPrice = numerator / denominator (integer division, BigInt-safe).
  const scaledPrice = numerator / denominator;
  // raw = scaledPrice / 1e18, as a float.
  return Number(scaledPrice) / 1e18;
}

/**
 * Compute the human-readable token1-per-token0 price, adjusted for token decimals.
 *
 * @param sqrtPriceX96 slot0.sqrtPriceX96
 * @param decimals0 token0 decimals (typically 18 for WETH, 6 for USDC)
 * @param decimals1 token1 decimals
 * @returns token1 per token0 in human units (e.g. how many USDC for 1 WETH)
 */
export function v3Price(
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
): number {
  const raw = v3PriceRaw(sqrtPriceX96);
  // priceHuman (token1 per token0) = raw × 10^(decimals0 - decimals1).
  // raw is in smallest-unit terms; multiplying by 10^(d0-d1) converts to human units.
  const decimalAdjust = decimals0 - decimals1;
  return raw * Math.pow(10, decimalAdjust);
}

/**
 * Compute a Uniswap V2-family price from reserves: token1 per token0.
 * `price = reserve1 / reserve0` (after decimal adjustment).
 *
 * Uses BigInt scaling to avoid float precision loss on large reserves
 * (1e18 > MAX_SAFE_INTEGER).
 */
export function v2Price(
  reserve0: bigint,
  reserve1: bigint,
  decimals0: number,
  decimals1: number,
): number {
  if (reserve0 === 0n) {
    return 0;
  }
  // Scale up by 1e18 before dividing so we keep ~18 digits of precision, then divide down.
  const SCALED = 10n ** 18n;
  const scaledNumerator = reserve1 * SCALED;
  const scaledPrice = scaledNumerator / reserve0; // price in smallest-unit * 1e18
  const raw = Number(scaledPrice) / 1e18;
  const decimalAdjust = decimals0 - decimals1;
  return raw * Math.pow(10, decimalAdjust);
}

/**
 * Convert a price ratio to basis-point spread between two venues.
 * `spreadBps = (sellPrice - buyPrice) / buyPrice * 10000`.
 * Returns 0 when buyPrice is non-positive.
 */
export function spreadBps(buyPrice: number, sellPrice: number): number {
  if (buyPrice <= 0) {
    return 0;
  }
  return Math.round(((sellPrice - buyPrice) / buyPrice) * 10000);
}
