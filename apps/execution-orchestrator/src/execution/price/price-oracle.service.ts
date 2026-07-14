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
 *   3. ARBITRARY token → discover a UniV2-style token↔WETH pool, derive the
 *      token price in WETH from `reserve0/reserve1` + token decimals, then
 *      multiply by the WETH/WBNB USD price (tier 2). V3 pools are NOT used for
 *      pricing (their "reserves" in DiscoveredPool are faked = liquidity).
 *
 * In-memory price cache (TTL 10s, single-flight) + decimals cache (permanent,
 * decimals never change). All on-chain reads are best-effort: any failure
 * resolves to `null` and the caller (evaluateTrade / capital accounting)
 * decides whether to block.
 *
 * Fail-state: price unresolved → null (never throws). Callers treat null as
 * "cannot value this position" and fail-closed on live paths.
 */

const PRICE_CACHE_TTL_MS = 10_000; // 10s — prices move fast, but per-leg churn is low
const METRIC_NAME = 'arb_price_oracle_lookup_total';

interface PriceCacheEntry {
  price: number | null;
  expiresAt: number;
}

interface AggregatorV3Contract {
  decimals(): Promise<number>;
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
      // Cache both resolved prices and explicit nulls (avoid retry-storm within TTL).
      this.priceCache.set(key, { price, expiresAt: Date.now() + PRICE_CACHE_TTL_MS });
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
      if (decimals <= 0 || round.answer <= 0n) {
        return null;
      }
      const scaled = Number(round.answer) / 10 ** decimals;
      return Number.isFinite(scaled) && scaled > 0 ? scaled : null;
    } catch (e) {
      this.logger.warn(
        `Chainlink native/USD read failed (chain=${chainId}): ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * Price an arbitrary token via a token↔WETH UniV2 pool:
   *   tokenPriceUsd = (reserveWETH / decimalsWETH) / (reserveToken / decimalsToken) × wethUsd
   *
   * V3 pools are ignored (their reserves are faked in DiscoveredPool).
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
    if (pool.protocol === 'uniswap-v3') {
      // V3 reserves are unreliable for pricing in v1; skip.
      return null;
    }

    try {
      const tokenDecimals = await this.getTokenDecimals(chainId, tokenLower);
      if (tokenDecimals === null) {
        return null;
      }
      const wethDecimals = 18; // WETH/WBNB are always 18 decimals.

      // Determine which side of the pool is WETH.
      const [tokenReserve, wethReserve] =
        pool.token0.toLowerCase() === wethLower
          ? [pool.reserve1, pool.reserve0] // token1 is the arbitrary token
          : [pool.reserve0, pool.reserve1]; // token0 is the arbitrary token

      if (tokenReserve <= 0n || wethReserve <= 0n) {
        return null;
      }

      // tokenPriceInWeth = (wethReserve / 10^18) / (tokenReserve / 10^tokenDecimals)
      const wethFloat = Number(wethReserve) / 10 ** wethDecimals;
      const tokenFloat = Number(tokenReserve) / 10 ** tokenDecimals;
      if (tokenFloat <= 0 || wethFloat <= 0) {
        return null;
      }
      const priceInWeth = wethFloat / tokenFloat;

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
