import { Injectable, Logger } from '@nestjs/common';
import { Contract, Provider } from 'ethers';
import { Counter } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import {
  AggregatorV3ABI,
  ERC20ABI,
  ChainId,
  Address,
  ZERO_ADDRESS,
  getArbitrumAddresses,
  getBaseAddresses,
  getBnbAddresses,
  v3Price,
} from '@arbibot/contracts-eth';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';
import { DiscoveredPool, PoolDiscoveryService } from '../pool/pool-discovery.service';

/**
 * Price Oracle Service (D4-B-2b).
 *
 * Resolves a token's USD price on a given chain via a 3-tier fallback:
 *   1. STABLES (USDC/USDT/BUSD) → $1 hardcoded (per ADR live-gate §2; v1
 *      ignores depeg — feed addresses are retained for future use).
 *   2. WETH / WBNB → Chainlink AggregatorV3 (ETH/USD on Arbitrum+Base,
 *      BNB/USD on BNB Chain).
 *   3. ARBITRARY token → discover a token↔WETH pool and derive the token price
 *      in WETH, then multiply by the WETH/WBNB USD price (tier 2). For V2/Sushi
 *      pools price is derived from `reserve0/reserve1`; for V3 pools from
 *      `slot0.sqrtPriceX96` via `v3Price()` (@arbibot/contracts-eth). V3
 *      `reserve0`/`reserve1` in `DiscoveredPool` carry `liquidity` and MUST NOT
 *      be used for pricing.
 *
 * In-memory price cache (TTL 10s, single-flight) + decimals cache (permanent,
 * decimals never change). All on-chain reads are best-effort: any failure
 * resolves to `null` and the caller (evaluateTrade / capital accounting)
 * decides whether to block.
 *
 * Fail-state: price unresolved → null (never throws). Callers treat null as
 * "cannot value this position" and fail-closed on live paths.
 */

// Cache TTL for resolved prices. 60s balances price freshness against RPC rate limits —
// public Arbitrum RPCs throttle around ~50 req/min and transient 429s were poisoning the
// cache when nulls were cached at the previous 10s TTL. Resolved prices only land here;
// nulls are never cached (transient failures should be retried on the next call, not
// served from cache). See docs/live-rpc-diagnosis-2026-08-05.md.
const PRICE_CACHE_TTL_MS = 60_000;

/**
 * Hard-coded decimals for well-known Arbitrum One tokens (fix #9).
 *
 * Why: `erc20.decimals()` is an extra RPC call per token per cold start. Public
 * Arbitrum RPCs throttle aggressively, and a transient rate-limit on that call
 * cascades into the cost gate blocking every trade. These are the tokens the
 * TokenResolverService emits on the live MVP path (USDC, USDT, WETH + the
 * long-tail scanner pairs). The map is consulted first; an on-chain read only
 * runs for tokens not in the map.
 *
 * Addresses are lowercase to match the cache key normalization. Source: each
 * token contract on Arbitrum One (decimals() call).
 */
const KNOWN_DECIMALS_BY_ADDRESS: Record<string, number> = {
  // Arbitrum One (42161) — staples + the long-tail tokens the scanner emits.
  '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 18, // WETH
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 6, // USDC (native)
  '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8': 6, // USDC.e (bridged)
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 6, // USDT
  '0x912ce59144191c1204e64859c7384b37e22328d5': 18, // ARB
  '0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a': 18, // GMX
  '0x539bde0d7dbd336b79148aa742883198bbf60342': 18, // MAGIC
  '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f': 8, // WBTC
  '0xf97f4df75117a78c1a5a0dbb814af92458539fb4': 18, // LINK
  '0xfa7f8980b0f1e64a2062791cc3b0871572f1f7f0': 18, // UNI
  '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1': 18, // DAI
  '0x11cdb42b0eb46d95f990bedd4695a6e3fa034978': 18, // CRV
  '0x13ad51ed4f1b7e9dc168d8a00cb3f4ddd85efa60': 18, // LDO
};
const METRIC_NAME = 'arb_price_oracle_lookup_total';

interface PriceCacheEntry {
  price: number | null;
  expiresAt: number;
}

interface AggregatorV3Contract {
  // ethers v6 returns uint8 decimals() as number via JsonRpcProvider but as
  // bigint via FallbackProvider (aggregated child result). Callers normalize.
  decimals(): Promise<number | bigint>;
  latestRoundData(): Promise<{
    roundId: bigint;
    answer: bigint;
    startedAt: bigint;
    updatedAt: bigint;
    answeredInRound: bigint;
  }>;
}

interface Erc20Contract {
  decimals(): Promise<number>;
}

/** Stable USD peg assumed for v1 (USDC/USDT/BUSD). */
const STABLE_USD_PRICE = 1;

@Injectable()
export class PriceOracleService {
  private readonly logger = new Logger(PriceOracleService.name);

  /** Price cache keyed by `${chainId}:${tokenAddressLower}`. */
  private readonly priceCache = new Map<string, PriceCacheEntry>();
  /** Decimals cache keyed by `${chainId}:${tokenAddressLower}` (never expires). */
  private readonly decimalsCache = new Map<string, number>();
  /** Single-flight: one in-flight lookup per token. */
  private readonly inflight = new Map<string, Promise<number | null>>();

  private readonly lookupCounter: Counter<string>;

  constructor(
    private readonly rpc: RpcProviderManager,
    private readonly pools: PoolDiscoveryService,
  ) {
    this.lookupCounter = this.initializeMetric();
  }

  /**
   * Resolve a token's USD price on `chainId`. Returns `null` if the price
   * cannot be resolved (RPC down, no pool, stale feed). Never throws.
   *
   * `tokenAddress` is case-insensitive; internally lowercased for cache keys.
   */
  async getTokenPriceUsd(chainId: ChainId, tokenAddress: Address): Promise<number | null> {
    const tokenLower = tokenAddress.toLowerCase() as Address;
    const key = `${chainId}:${tokenLower}`;

    // 1. Cache hit.
    const cached = this.priceCache.get(key);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      this.lookupCounter.inc({ result: 'hit' });
      return cached.price;
    }

    // 2. Single-flight: coalesce concurrent lookups for the same token.
    const existing = this.inflight.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const promise = (async (): Promise<number | null> => {
      const price = await this.resolvePriceUncached(chainId, tokenLower).catch((e: unknown) => {
        this.logger.warn(
          `price lookup failed (chain=${chainId}, token=${tokenLower}): ${e instanceof Error ? e.message : String(e)}`,
        );
        return null;
      });
      // Cache RESOLVED prices only — do NOT cache nulls. Caching nulls (previous behaviour)
      // meant a transient RPC failure (rate limit, momentary network blip) would freeze every
      // subsequent price read at null for the whole TTL window, blocking the live cost gate
      // even after the RPC recovered. Now a null retries on the next call.
      if (price !== null) {
        this.priceCache.set(key, { price, expiresAt: Date.now() + PRICE_CACHE_TTL_MS });
      }
      this.lookupCounter.inc({ result: price === null ? 'failed' : 'miss' });
      return price;
    })();

    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  // ── Resolution tiers ──────────────────────────────────────────────────

  private async resolvePriceUncached(chainId: ChainId, tokenLower: Address): Promise<number | null> {
    // Tier 1: stables → $1.
    if (this.isStable(chainId, tokenLower)) {
      return STABLE_USD_PRICE;
    }

    // Tier 2: WETH/WBNB → Chainlink.
    const wrappedNative = this.getWrappedNative(chainId);
    if (wrappedNative !== null && tokenLower === wrappedNative.toLowerCase()) {
      return this.readChainlinkNativeUsd(chainId);
    }

    // Tier 3: arbitrary → token/WETH pool reserves × WETH USD price.
    return this.priceArbitraryViaPool(chainId, tokenLower);
  }

  private isStable(chainId: ChainId, tokenLower: Address): boolean {
    const addrs = this.getAddressesSafe(chainId);
    if (addrs === null) {
      return false;
    }
    const candidates: (Address | undefined)[] = [addrs.usdc, addrs.usdt, addrs.busd];
    return candidates.some((c) => c !== undefined && c.toLowerCase() === tokenLower);
  }

  private getWrappedNative(chainId: ChainId): Address | null {
    const addrs = this.getAddressesSafe(chainId);
    if (addrs === null) {
      return null;
    }
    if (addrs.weth !== undefined) {
      return addrs.weth;
    }
    if (addrs.wbnb !== undefined) {
      return addrs.wbnb;
    }
    return null;
  }

  /**
   * Read the native (ETH or BNB) USD price from the Chainlink feed.
   * Returns null if no feed is configured (e.g. testnet) or the read fails.
   */
  private async readChainlinkNativeUsd(chainId: ChainId): Promise<number | null> {
    const feed = this.getNativeFeed(chainId);
    if (feed === null || feed === ZERO_ADDRESS) {
      this.logger.debug(`no Chainlink native/USD feed for chain ${chainId}`);
      return null;
    }
    try {
      const provider = this.getProvider(chainId);
      const feedContract = new Contract(feed, AggregatorV3ABI, provider) as unknown as AggregatorV3Contract;
      const [round, decimals] = await Promise.all([
        feedContract.latestRoundData(),
        feedContract.decimals(),
      ]);
      // Chainlink feeds return the price scaled by 10^decimals (typically 8).
      // answer is signed int256; prices are positive.
      // NOTE on types: ethers v6 returns uint8 `decimals()` as a plain number when read
      // via a single JsonRpcProvider, but as a **bigint** (e.g. 8n) when read via a
      // FallbackProvider (it aggregates child results and returns bigint for small uints).
      // `round.answer` is always bigint. Normalize decimals to a number before any
      // arithmetic/comparison: `Number.isFinite(8n)` is false and `10 ** 8n` throws
      // "Cannot mix BigInt and other types". This was the silent cost-gate blocker after
      // pinFallbackNetwork (commit 6b583ba) made FallbackProvider actually work — before
      // that, NETWORK_ERROR masked this path entirely.
      const dec = typeof decimals === 'bigint' ? Number(decimals) : decimals;
      if (!Number.isFinite(dec) || dec <= 0) {
        return null;
      }
      if (round.answer <= 0n) {
        return null;
      }
      const scaled = Number(round.answer) / 10 ** dec;
      return Number.isFinite(scaled) && scaled > 0 ? scaled : null;
    } catch (e) {
      this.logger.warn(
        `Chainlink native/USD read failed (chain=${chainId}): ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * Resolve the native token (ETH or BNB) USD price for gas valuation.
   *
   * Thin wrapper over `readChainlinkNativeUsd` exposed publicly so the cost
   * estimator (and gas→USD conversion) can value gas in USD without duplicating
   * the Chainlink feed logic. Returns `null` when no feed is configured for the
   * chain (e.g. testnet) — callers fail-closed.
   */
  async getNativeUsdPrice(chainId: ChainId): Promise<number | null> {
    return this.readChainlinkNativeUsd(chainId);
  }

  /**
   * Price an arbitrary token via a token↔WETH pool, then convert to USD via the
   * Chainlink native/USD price (tier 2).
   *
   * - V2/Sushi pools: `tokenPriceInWeth = (wethReserve / 10^18) / (tokenReserve / 10^tokenDecimals)`.
   * - V3 pools: price is decoded from `slot0.sqrtPriceX96` via `v3Price()` and, when
   *   needed, inverted so it is expressed in WETH-per-token (regardless of which side
   *   of the pool is WETH). V3 `reserve0`/`reserve1` carry `liquidity`, not a price.
   *
   * `tokenPriceUsd = tokenPriceInWeth × wethUsd`. Returns null when the pool, decimals,
   * Chainlink feed, or any intermediate value is unavailable (fail-closed).
   */
  private async priceArbitraryViaPool(chainId: ChainId, tokenLower: Address): Promise<number | null> {
    const wrappedNative = this.getWrappedNative(chainId);
    if (wrappedNative === null) {
      return null;
    }
    const wethLower = wrappedNative.toLowerCase() as Address;

    // Scan cached pools for a token↔WETH pair on this chain.
    const pool = this.findTokenWethPool(chainId, tokenLower, wethLower);
    if (pool === null) {
      return null;
    }

    try {
      const tokenDecimals = await this.getTokenDecimals(chainId, tokenLower);
      if (tokenDecimals === null) {
        return null;
      }
      const wethDecimals = 18; // WETH/WBNB are always 18 decimals.

      // Protocol-specific token price in WETH (human units, WETH per 1 token).
      let priceInWeth: number;
      if (pool.protocol === 'uniswap-v3') {
        if (pool.sqrtPriceX96 === undefined) {
          // Stale cache entry from before the sqrtPriceX96 field was populated; treat as
          // unpriceable rather than guessing from liquidity-as-reserves.
          return null;
        }
        // v3Price returns token1-per-token0 in human units. We need WETH-per-token.
        const tokenIsToken0 = pool.token0.toLowerCase() === tokenLower;
        const decimals0 = tokenIsToken0 ? tokenDecimals : wethDecimals;
        const decimals1 = tokenIsToken0 ? wethDecimals : tokenDecimals;
        const t1PerT0 = v3Price(pool.sqrtPriceX96, decimals0, decimals1);
        if (!(t1PerT0 > 0)) {
          return null;
        }
        // token1 is WETH when token is token0 → t1PerT0 is already WETH-per-token.
        // When token is token1 → invert (token-per-WETH) to get WETH-per-token.
        priceInWeth = tokenIsToken0 ? t1PerT0 : 1 / t1PerT0;
      } else {
        // V2/Sushi: derive from reserves. Determine which side of the pool is WETH.
        const [tokenReserve, wethReserve] =
          pool.token0.toLowerCase() === wethLower
            ? [pool.reserve1, pool.reserve0] // token1 is the arbitrary token
            : [pool.reserve0, pool.reserve1]; // token0 is the arbitrary token

        if (tokenReserve <= 0n || wethReserve <= 0n) {
          return null;
        }
        const wethFloat = Number(wethReserve) / 10 ** wethDecimals;
        const tokenFloat = Number(tokenReserve) / 10 ** tokenDecimals;
        if (tokenFloat <= 0 || wethFloat <= 0) {
          return null;
        }
        priceInWeth = wethFloat / tokenFloat;
      }

      if (!(priceInWeth > 0)) {
        return null;
      }

      const wethUsd = await this.readChainlinkNativeUsd(chainId);
      if (wethUsd === null) {
        return null;
      }
      const usd = priceInWeth * wethUsd;
      return Number.isFinite(usd) && usd > 0 ? usd : null;
    } catch (e) {
      this.logger.warn(
        `arbitrary token pricing failed (chain=${chainId}, token=${tokenLower}): ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  private findTokenWethPool(
    chainId: ChainId,
    tokenLower: Address,
    wethLower: Address,
  ): DiscoveredPool | null {
    const pools = this.pools.getCachedPools(chainId);
    for (const p of pools) {
      const t0 = p.token0.toLowerCase();
      const t1 = p.token1.toLowerCase();
      const hasToken = t0 === tokenLower || t1 === tokenLower;
      const hasWeth = t0 === wethLower || t1 === wethLower;
      if (hasToken && hasWeth && t0 !== t1) {
        return p;
      }
    }
    return null;
  }

  /**
   * ERC20 decimals, cached permanently per token.
   *
   * Public so the live DEX adapters (D4-B-2d) can reuse the cached read when
   * converting raw `amountIn` to USD notional for the risk gate. Returns `null`
   * on any read failure (RPC down / non-ERC20); callers fail-closed.
   *
   * `tokenAddress` is case-insensitive; internally lowercased for cache keys.
   */
  async getTokenDecimals(chainId: ChainId, tokenAddress: Address): Promise<number | null> {
    const tokenLower = tokenAddress.toLowerCase() as Address;
    const key = `${chainId}:${tokenLower}`;
    const cached = this.decimalsCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    // Fallback for well-known tokens (fix #9). Avoids an RPC call on the hot path
    // and survives transient RPC rate-limits that would otherwise null-out decimals
    // and fail-closed the cost gate.
    if (chainId === ChainId.ARBITRUM_ONE_MAINNET) {
      const known = KNOWN_DECIMALS_BY_ADDRESS[tokenLower];
      if (typeof known === 'number') {
        this.decimalsCache.set(key, known);
        return known;
      }
    }
    try {
      const provider = this.getProvider(chainId);
      const erc20 = new Contract(tokenLower, ERC20ABI, provider) as unknown as Erc20Contract;
      const decimals = await erc20.decimals();
      if (!Number.isFinite(decimals) || decimals < 0 || decimals > 36) {
        return null;
      }
      this.decimalsCache.set(key, decimals);
      return decimals;
    } catch (e) {
      this.logger.warn(
        `decimals read failed (chain=${chainId}, token=${tokenLower}): ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  // ── Address helpers (testnet returns null → caller fails-closed) ──────

  private getProvider(chainId: ChainId): Provider {
    return this.rpc.getProvider(chainId);
  }

  private getNativeFeed(chainId: ChainId): Address | null {
    // BNB chain exposes a BNB/USD feed; Arbitrum/Base expose ETH/USD.
    if (chainId === ChainId.BNB_CHAIN_MAINNET || chainId === ChainId.BNB_CHAIN_TESTNET) {
      try {
        return getBnbAddresses(chainId).chainlinkBnbUsd;
      } catch {
        return null;
      }
    }
    const a = this.getEthChainAddressesSafe(chainId);
    return a !== null ? a.chainlinkEthUsd : null;
  }

  private getEthChainAddressesSafe(
    chainId: ChainId,
  ): { chainlinkEthUsd: Address; chainlinkUsdcUsd: Address; chainlinkUsdtUsd: Address } | null {
    if (chainId === ChainId.ARBITRUM_ONE_MAINNET || chainId === ChainId.ARBITRUM_ONE_SEPOLIA) {
      const a = getArbitrumAddresses(chainId);
      return {
        chainlinkEthUsd: a.chainlinkEthUsd,
        chainlinkUsdcUsd: a.chainlinkUsdcUsd,
        chainlinkUsdtUsd: a.chainlinkUsdtUsd,
      };
    }
    if (chainId === ChainId.BASE_MAINNET || chainId === ChainId.BASE_SEPOLIA) {
      const a = getBaseAddresses(chainId);
      return {
        chainlinkEthUsd: a.chainlinkEthUsd,
        chainlinkUsdcUsd: a.chainlinkUsdcUsd,
        chainlinkUsdtUsd: a.chainlinkUsdtUsd,
      };
    }
    return null;
  }

  /** Returns the union address shape used by isStable/getWrappedNative. */
  private getAddressesSafe(chainId: ChainId): {
    usdc: Address;
    usdt: Address;
    busd?: Address;
    weth?: Address;
    wbnb?: Address;
  } | null {
    try {
      if (chainId === ChainId.ARBITRUM_ONE_MAINNET || chainId === ChainId.ARBITRUM_ONE_SEPOLIA) {
        const a = getArbitrumAddresses(chainId);
        return { usdc: a.usdc, usdt: a.usdt, weth: a.weth };
      }
      if (chainId === ChainId.BASE_MAINNET || chainId === ChainId.BASE_SEPOLIA) {
        const a = getBaseAddresses(chainId);
        return { usdc: a.usdc, usdt: a.usdt, weth: a.weth };
      }
      if (chainId === ChainId.BNB_CHAIN_MAINNET || chainId === ChainId.BNB_CHAIN_TESTNET) {
        const a = getBnbAddresses(chainId);
        return { usdc: a.usdc, usdt: a.usdt, busd: a.busd, wbnb: a.wbnb };
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Clear caches (test hook). */
  clearCachesForTest(): void {
    this.priceCache.clear();
    this.decimalsCache.clear();
  }

  private initializeMetric(): Counter<string> {
    const registry = getArbibotMetricsRegistry();
    const existing = registry.getSingleMetric(METRIC_NAME);
    if (existing !== undefined) {
      return existing as Counter<string>;
    }
    return new Counter({
      name: METRIC_NAME,
      help: 'Price oracle lookups by outcome',
      labelNames: ['result'],
      registers: [registry],
    });
  }
}
