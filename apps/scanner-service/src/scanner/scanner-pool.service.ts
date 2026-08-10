import { Injectable, Logger } from '@nestjs/common';
import { Contract } from 'ethers';
import { Counter, Gauge } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { v2Price, v3Price } from '@arbibot/contracts-eth';

import {
  ERC20_DECIMALS_ABI,
  resolveFactory,
  UNI_V2_POOL_ABI,
  UNI_V3_POOL_SCANNER_ABI,
  type FactoryMapping,
} from './scanner-pool.constants';
import { DEFAULT_SCANNER_POOL_CACHE_TTL_MS } from './scanner-config.constants';
import { resolveQuoteUsd } from './scanner-stablecoins';
import { ScannerRpcService } from './scanner-rpc.service';

/** Typed view-method surfaces for the V2/V3 pool contracts (cast from ethers Contract). */
interface UniV2PoolContract {
  token0(): Promise<string>;
  token1(): Promise<string>;
  getReserves(): Promise<readonly [bigint, bigint, number]>;
  factory(): Promise<string> & { catch(onRejected: (e: unknown) => unknown): Promise<unknown> };
}
interface UniV3PoolContract {
  token0(): Promise<string>;
  token1(): Promise<string>;
  fee(): Promise<bigint>;
  slot0(): Promise<readonly [bigint, number, number, number, number, boolean]>;
  liquidity(): Promise<bigint>;
  factory(): Promise<string> & { catch(onRejected: (e: unknown) => unknown): Promise<unknown> };
}
interface Erc20Contract {
  decimals(): Promise<number>;
}

/**
 * Resolved pool snapshot — what a single venue prices a token pair at.
 * `quotePerBase` is the amount of quoteAsset (token1) per 1 unit of baseAsset (token0).
 */
export interface PoolSnapshot {
  chainId: number;
  poolAddress: string;
  venueKey: string;
  family: 'v2' | 'v3';
  token0: string;
  token1: string;
  decimals0: number;
  decimals1: number;
  feeBps: number;
  /** Price of token0 denominated in token1 (quote per base). */
  quotePerBase: number;
  /** Liquidity in USD (rough: requires a USD reference price — left null in this slice). */
  liquidityUsd: number | null;
  reserve0: bigint | null;
  reserve1: bigint | null;
  blockNumber: number | null;
  readAt: number;
}

interface CacheEntry {
  snapshot: PoolSnapshot;
  expiresAt: number;
}

/** Scanner pool metrics (created once via {@link createScannerPoolMetrics}). */
interface ScannerPoolMetrics {
  cacheHits: Counter<string>;
  cacheMisses: Counter<string>;
  volumeReverts: Counter<string>;
  cacheHitRatio: Gauge<string>;
}

/** Build the scanner pool metrics on the shared registry (idempotent on re-registration). */
function createScannerPoolMetrics(): ScannerPoolMetrics {
  const reg = getArbibotMetricsRegistry();
  const existing = (name: string): Counter<string> | undefined =>
    reg.getSingleMetric(name) as Counter<string> | undefined;
  const make = (
    name: string,
    help: string,
  ): Counter<string> =>
    existing(name) ??
    new Counter({ name, help, labelNames: ['chain_id'], registers: [reg] });
  const cacheHits = make('arb_scanner_pool_cache_hits_total', 'Scanner pool-read cache hits');
  const cacheMisses = make('arb_scanner_pool_cache_misses_total', 'Scanner pool-read cache misses');
  const volumeReverts = make('arb_scanner_volume_revert_total', 'Scanner V3 volumeToken0/1 reverts (fork/testnet without the getter)');
  const cacheHitRatio =
    (reg.getSingleMetric('arb_scanner_pool_cache_hit_ratio') as Gauge<string> | undefined) ??
    new Gauge({
      name: 'arb_scanner_pool_cache_hit_ratio',
      help: 'Cumulative scanner pool-read cache hit ratio (hits / (hits + misses))',
      labelNames: ['chain_id'],
      registers: [reg],
    });
  const result: ScannerPoolMetrics = { cacheHits, cacheMisses, volumeReverts, cacheHitRatio };
  return result;
}

/**
 * Recompute the cache hit ratio gauge from locally-tracked counters. We mirror hits/misses
 * in plain numbers (rather than reading them back from the prom-client Counter, whose `.get()`
 * is async) and set the gauge as hits/(hits+misses) per chain.
 */
function refreshCacheHitRatio(
  m: ScannerPoolMetrics,
  chainId: number,
  hits: number,
  misses: number,
): void {
  const total = hits + misses;
  m.cacheHitRatio.set({ chain_id: String(chainId) }, total === 0 ? 0 : hits / total);
}

/**
 * Scanner pool reader (S1-5-POOL).
 *
 * Reads V2 (getReserves) and V3 (slot0.sqrtPriceX96 + liquidity) pool state via read-only
 * ethers v6 contracts, resolves the venue from the on-chain factory() call, and caches the
 * snapshot per (chain, venue, pool) with a TTL. Every read first consults
 * {@link ScannerRpcService.tryAcquire} so the token-bucket rate budget bounds outbound RPC.
 *
 * Fixes the execution pool-discovery gap (pool-discovery.service.ts:236) where V3 "price" was
 * just liquidity dumped into both reserves — here we compute the real price from sqrtPriceX96.
 */
@Injectable()
export class ScannerPoolService {
  private readonly logger = new Logger(ScannerPoolService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly metrics: ScannerPoolMetrics;
  /** Per-chain cache access counters mirrored locally for synchronous ratio computation. */
  private readonly cacheHitsByChain = new Map<number, number>();
  private readonly cacheMissesByChain = new Map<number, number>();

  constructor(private readonly rpc: ScannerRpcService) {
    this.metrics = createScannerPoolMetrics();
  }

  /** Current cache size (for diagnostics / health). */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Read a pool snapshot for `(chainId, poolAddress)`. Returns null on any read failure
   * (unconfigured chain, rate-limited, RPC error, unknown factory). Cached for the TTL.
   */
  async readPool(chainId: number, poolAddress: string): Promise<PoolSnapshot | null> {
    const cacheKey = `${chainId}:${poolAddress.toLowerCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      this.metrics.cacheHits.inc({ chain_id: String(chainId) });
      this.recordCacheAccess(chainId, true);
      return cached.snapshot;
    }

    // Rate budget gate.
    if (!this.rpc.tryAcquire(chainId)) {
      this.logger.debug(`RPC rate-limited for chain ${chainId}; pool read skipped`);
      return null;
    }

    this.metrics.cacheMisses.inc({ chain_id: String(chainId) });
    this.recordCacheAccess(chainId, false);
    const snapshot = await this.fetchPool(chainId, poolAddress).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Pool read failed for ${cacheKey}: ${msg}`);
      return null;
    });
    if (snapshot !== null) {
      const ttlMs = this.resolveCacheTtlMs();
      this.cache.set(cacheKey, { snapshot, expiresAt: Date.now() + ttlMs });
    }
    return snapshot;
  }

  /** Bump the local mirror for one chain and refresh the hit-ratio gauge. */
  private recordCacheAccess(chainId: number, hit: boolean): void {
    const hits = (this.cacheHitsByChain.get(chainId) ?? 0) + (hit ? 1 : 0);
    const misses = (this.cacheMissesByChain.get(chainId) ?? 0) + (hit ? 0 : 1);
    this.cacheHitsByChain.set(chainId, hits);
    this.cacheMissesByChain.set(chainId, misses);
    refreshCacheHitRatio(this.metrics, chainId, hits, misses);
  }

  /** Drop all cached entries (e.g. on force-refresh). */
  clearCache(): void {
    this.cache.clear();
  }

  // --- internal ------------------------------------------------------------

  private resolveCacheTtlMs(): number {
    const raw = process.env.SCANNER_POOL_CACHE_TTL_MS ?? String(DEFAULT_SCANNER_POOL_CACHE_TTL_MS);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_SCANNER_POOL_CACHE_TTL_MS;
  }

  private async fetchPool(
    chainId: number,
    poolAddress: string,
  ): Promise<PoolSnapshot | null> {
    const provider = this.rpc.getProvider(chainId);
    // Try V2 first (cheaper, one multicall). Fall back to V3 if V2 calls revert.
    const v2 = await this.tryV2(chainId, poolAddress, provider).catch(() => null);
    if (v2 !== null) {
      return this.withLiquidityUsd(v2);
    }
    const v3 = await this.tryV3(chainId, poolAddress, provider).catch(() => null);
    if (v3 !== null) {
      return this.withLiquidityUsd(v3);
    }
    return null;
  }

  /**
   * Populate `liquidityUsd` on a freshly-read pool snapshot (PLAN13/Hermes improvement).
   *
   * Previously `liquidityUsd` was always `null` and the spread-service computed USD liquidity
   * on-the-fly in `bestSpreadForPair`. Filling it here makes the value available on the
   * snapshot itself — for observability (logs show each pool's USD liquidity), for future
   * filters that read `PoolSnapshot` directly, and so the spread filter doesn't recompute it.
   *
   * USD conversion: `resolveQuoteUsd` returns 1.0 when EITHER token is a stablecoin (checked
   * both legs — some pools sort the stable as token0), else the native-asset USD price from
   * `SCANNER_NATIVE_USD`. V3 pools return null (their reserve fields hold `liquidity`, not
   * real reserves). Pure + synchronous; `SCANNER_NATIVE_USD` is read once per call.
   */
  private withLiquidityUsd(snapshot: PoolSnapshot): PoolSnapshot {
    if (snapshot.family === 'v3') {
      return snapshot; // V3 reserve0/1 hold `liquidity`, not real reserves — leave null.
    }
    const nativeUsd = Number(process.env.SCANNER_NATIVE_USD ?? 0);
    const quoteUsd = resolveQuoteUsd(snapshot.token0, snapshot.token1, nativeUsd);
    return { ...snapshot, liquidityUsd: computePoolLiquidityUsdFromSnapshot(snapshot, quoteUsd) };
  }

  private async tryV2(
    chainId: number,
    poolAddress: string,
    provider: ReturnType<ScannerRpcService['getProvider']>,
  ): Promise<PoolSnapshot | null> {
    const contract = new Contract(poolAddress, [...UNI_V2_POOL_ABI], provider) as unknown as UniV2PoolContract;
    const token0 = await contract.token0();
    const token1 = await contract.token1();
    const reserves = await contract.getReserves();
    const factory = (await contract.factory().catch(() => null));

    const mapping = factory !== null ? resolveFactory(chainId, factory) : undefined;
    // Only treat as V2 if the factory maps to a v2 family; otherwise this is a V3 pool and
    // the V2 ABI reverted silently (token0/token1 happen to exist on both).
    if (mapping === undefined || mapping.family !== 'v2') {
      return null;
    }

    const [decimals0, decimals1] = await this.readDecimals(provider, token0, token1);
    const reserve0 = reserves[0];
    const reserve1 = reserves[1];
    const quotePerBase = v2Price(reserve0, reserve1, decimals0, decimals1);
    return {
      chainId,
      poolAddress,
      venueKey: mapping.venueKey,
      family: 'v2',
      token0,
      token1,
      decimals0,
      decimals1,
      feeBps: mapping.defaultFeeBps,
      quotePerBase,
      liquidityUsd: null,
      reserve0,
      reserve1,
      blockNumber: null,
      readAt: Date.now(),
    };
  }

  private async tryV3(
    chainId: number,
    poolAddress: string,
    provider: ReturnType<ScannerRpcService['getProvider']>,
  ): Promise<PoolSnapshot | null> {
    const contract = new Contract(poolAddress, [...UNI_V3_POOL_SCANNER_ABI], provider) as unknown as UniV3PoolContract;
    const token0 = await contract.token0();
    const token1 = await contract.token1();
    const fee = await contract.fee();
    const slot0 = await contract.slot0();
    const liquidity = await contract.liquidity();
    const factory = (await contract.factory().catch(() => null));

    const mapping = factory !== null ? resolveFactory(chainId, factory) : undefined;
    if (mapping === undefined || mapping.family !== 'v3') {
      return null;
    }

    const [decimals0, decimals1] = await this.readDecimals(provider, token0, token1);
    const sqrtPriceX96 = slot0[0];
    const quotePerBase = v3Price(sqrtPriceX96, decimals0, decimals1);

    return {
      chainId,
      poolAddress,
      venueKey: mapping.venueKey,
      family: 'v3',
      token0,
      token1,
      decimals0,
      decimals1,
      feeBps: Number(fee) / 100,
      quotePerBase,
      liquidityUsd: null,
      // V3 has no reserves; store active liquidity in both fields as a rough liquidity signal
      // (the Phase 2 minLiquidityUsd filter converts this to USD with a quote price).
      reserve0: liquidity,
      reserve1: liquidity,
      blockNumber: null,
      readAt: Date.now(),
    };
  }

  /** Read token decimals (cached implicitly by the pool TTL). Two cheap view calls. */
  private async readDecimals(
    provider: ReturnType<ScannerRpcService['getProvider']>,
    token0: string,
    token1: string,
  ): Promise<[number, number]> {
    const c0 = new Contract(token0, [...ERC20_DECIMALS_ABI], provider) as unknown as Erc20Contract;
    const c1 = new Contract(token1, [...ERC20_DECIMALS_ABI], provider) as unknown as Erc20Contract;
    const [d0, d1] = await Promise.all([
      c0.decimals().catch(() => 18),
      c1.decimals().catch(() => 18),
    ]);
    return [Number(d0), Number(d1)];
  }

  /** Factory mapping accessor exposed for tests / health. */
  resolveFactoryMapping(chainId: number, factoryAddress: string): FactoryMapping | undefined {
    return resolveFactory(chainId, factoryAddress);
  }
}

/**
 * Compute a V2 pool's approximate liquidity in USD from its reserves (PLAN13 #1, relocated
 * from spread-service so it can populate `PoolSnapshot.liquidityUsd` at read time).
 *
 * Only meaningful for V2 pools, which carry real `getReserves()` values. V3 pools store
 * `liquidity` in reserve0/reserve1 — the caller passes `quoteUsd` and this function returns
 * the sum of both legs' USD value; V3 snapshots are skipped upstream (`withLiquidityUsd`).
 *
 * `quoteUsd` is the USD price of the quote token: `1.0` for stablecoins (resolved by
 * `resolveQuoteUsd` from either token0 or token1), else `SCANNER_NATIVE_USD` for WETH/WBNB.
 * Returns 0 when reserves are null/missing (defensive — treated as illiquid, fail-safe).
 *
 * Exported so the spread-service dead-pool filter can reuse the same math without duplicating.
 */
export function computePoolLiquidityUsdFromSnapshot(
  pool: PoolSnapshot,
  quoteUsd: number,
): number | null {
  if (pool.family === 'v3') {
    return null;
  }
  const { reserve0, reserve1, decimals0, decimals1, quotePerBase } = pool;
  if (reserve0 === null || reserve1 === null) {
    return 0;
  }
  if (decimals0 <= 0 || decimals1 <= 0 || !Number.isFinite(quotePerBase) || quotePerBase <= 0) {
    return 0;
  }
  if (!Number.isFinite(quoteUsd) || quoteUsd <= 0) {
    return 0;
  }
  const baseHuman = Number(reserve0) / 10 ** decimals0;
  const quoteHumanFromBase = baseHuman * quotePerBase;
  const quoteHuman = Number(reserve1) / 10 ** decimals1;
  return (quoteHumanFromBase + quoteHuman) * quoteUsd;
}
