import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { JsonRpcProvider, Contract } from 'ethers';
import { Counter, Gauge, Histogram } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';
import { ChainId, Address } from '@arbibot/contracts-eth';

/**
 * Typed UniV2 pool contract (getReserves)
 */
interface UniV2PoolContract {
  token0(): Promise<string>;
  token1(): Promise<string>;
  getReserves(): Promise<[bigint, bigint, number]>;
  factory(): Promise<string>;
}

/**
 * Typed UniV3 pool contract (slot0 + liquidity)
 */
interface UniV3PoolContract {
  token0(): Promise<string>;
  token1(): Promise<string>;
  fee(): Promise<number>;
  factory(): Promise<string>;
  liquidity(): Promise<bigint>;
  slot0(): Promise<[bigint, number, number, number, number, number, boolean]>;
}

/**
 * Discovered DEX pool.
 *
 * `sqrtPriceX96` is populated ONLY for V3 pools and is the authoritative price source
 * (`slot0.sqrtPriceX96`). For V3 pools `reserve0`/`reserve1` carry `liquidity` (not a
 * price) and MUST NOT be used for pricing — use `v3Price(sqrtPriceX96, d0, d1)` from
 * `@arbibot/contracts-eth`. For V2/Sushi pools `reserve0`/`reserve1` are real reserves.
 */
export interface DiscoveredPool {
  address: Address;
  token0: Address;
  token1: Address;
  feeBps: number;
  reserve0: bigint;
  reserve1: bigint;
  /**
   * V3-only: `slot0.sqrtPriceX96`, the encoded token1/token0 price ratio. `undefined`
   * for V2/Sushi pools. See `PriceOracleService.priceArbitraryViaPool` V3 branch.
   */
  sqrtPriceX96?: bigint;
  chainId: ChainId;
  factory: Address;
  protocol: 'uniswap-v2' | 'uniswap-v3' | 'sushiswap';
  blockNumber: number;
  discoveredAt: Date;
}

/**
 * Pool cache entry with TTL
 */
interface PoolCacheEntry {
  pool: DiscoveredPool;
  expiresAt: number;
}

/**
 * Seed pool address (chainId + address) for warm-up. The cache is in-memory and
 * empty after a process restart; without warm-up the first N pricing calls hit
 * null pools and fail-closed. Seeds are discovered once on startup and re-freshed
 * on every discovery loop tick so reserves stay current.
 */
interface SeedPoolEntry {
  chainId: ChainId;
  address: Address;
}

/**
 * Default seed pools — the highest-volume WETH/stablecore pairs on Arbitrum One
 * (single-chain live MVP). Operators can override / extend via the
 * `POOL_DISCOVERY_SEED_ADDRESSES` env (comma-separated `chainId:0xADDR` entries).
 *
 * These are the pools PriceOracleService.priceArbitraryViaPool() scans for when
 * valuing long-tail tokens (it looks for a token↔WETH pair). Without warm-up
 * those reads return null and the live cost gate blocks every trade.
 *
 * Addresses sourced from SushiSwap factory getPair() on Arbitrum One
 * (0xc35DADB65012eC5796536bD9864eD8773aBc74C4) — verified to return real bytecode
 * and live reserves on-chain (2026-08-05). Previous hardcoded values were typos
 * with bad checksums and the warm-up silently no-op'd on every restart.
 */
const DEFAULT_SEED_POOLS: SeedPoolEntry[] = [
  // Arbitrum One (42161) — SushiSwap V2 pools for the staples.
  { chainId: 42161, address: '0x57b85FEf094e10b5eeCDF350Af688299E9553378' }, // WETH/USDC (native)
  { chainId: 42161, address: '0x905dfCD5649217c42684f23958568e533C711Aa3' }, // WETH/USDC.e (bridged)
  { chainId: 42161, address: '0xCB0E5bFa72bBb4d16AB5aA0c60601c438F04b4ad' }, // WETH/USDT
  // Long-tail token/WETH pools (UniV3 0.05%) — PriceOracle needs these in cache to value
  // non-stable tokens via sqrtPriceX96 (V3 pricing branch). Without them getTokenPriceUsd
  // returns null → notional null → confidence 'modeled' (non-blocking, but imprecise).
  // Addresses verified on-chain via eth_getCode + slot0 (2026-08-06, BlockPi).
  { chainId: 42161, address: '0xF44f17A6Fc5D2f0Ad1FF47e682570fa5A8eb9050' }, // MAGIC/WETH (UniV3 0.05%)
  { chainId: 42161, address: '0xb435ebfE0BF4CE66810AA4d44e3a5CA875D40DB1' }, // GMX/WETH (UniV3 0.05%)
  { chainId: 42161, address: '0x91308bC9Ce8Ca2db82aA30C65619856cC939d907' }, // LINK/WETH (UniV3 0.05%)
  { chainId: 42161, address: '0xff96D42dc8E2700ABAb1f1F82Ecf699caA1a2056' }, // UNI/WETH (UniV3 0.05%)
  { chainId: 42161, address: '0x14Cc036360C896c20Bc816A2a7aA514bC843766f' }, // CRV/WETH (UniV3 0.05%)
  { chainId: 42161, address: '0xE4Cd69C5F4bc7803b2Fb745C984446b935b54249' }, // LDO/WETH (UniV3 0.05%)
  // FIX-G (2026-08-11): liquid (fee=0.30%) counterparts for actively-traded
  // long-tail pairs. The 0.05% pools above are thin for some pairs (MAGIC liq
  // ~9e15 vs ~2.9e22 at 0.30%), and PriceOracle priced MAGIC off the thin
  // pool's drifted sqrtPriceX96 ($0.23 vs liquid $0.267). That misprice flowed
  // into both the cost gate (notional) and the live slippage gate (phantom
  // 1357 bps impact → every trade blocked). Seeding the liquid tier lets
  // findTokenWethPool (now max-liquidity) price from the deep pool, and lets
  // the cost estimator's V3 path (FIX-E/F) match the fee tier the plan trades.
  // Addresses verified on-chain 2026-08-11 via factory.getPool + liquidity().
  { chainId: 42161, address: '0xa95b0F5a65a769d82AB4F3e82842E45B8bbAf101' }, // MAGIC/WETH (UniV3 0.30%, liq 2.9e22)
  { chainId: 42161, address: '0xC24f7d8E51A64dc1238880BD00bb961D54cbeb29' }, // UNI/WETH (UniV3 0.30%, liq 9.3e21)
  // WBTC/WETH (UniV3 0.05%). Verified on-chain 2026-08-09: contract 22142 bytes,
  // token0=0x2f2a2543...(WBTC), token1=0x82af4944...(WETH), fee=0.05%, live liquidity.
  // Required for the V3 pricing branch — without it the live path fails
  // "cannot price tokenIn 0x2f2a... (WBTC)" at the cost gate.
  { chainId: 42161, address: '0x2f5e87C9312fa29aed5c179E456625D79015299c' }, // WBTC/WETH (UniV3 0.05%)
];

/**
 * Parse the `POOL_DISCOVERY_SEED_ADDRESSES` env (format: `42161:0xADDR,42161:0xADDR`)
 * into typed entries. Returns the DEFAULT_SEED_POOLS when unset. Malformed entries
 * are logged and skipped — never throw (warm-up is best-effort).
 */
function loadSeedPools(log: (msg: string) => void): SeedPoolEntry[] {
  const raw = process.env.POOL_DISCOVERY_SEED_ADDRESSES;
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_SEED_POOLS;
  }
  const out: SeedPoolEntry[] = [];
  for (const token of raw.split(/[,\s]+/)) {
    const t = token.trim();
    if (t.length === 0) continue;
    const colon = t.lastIndexOf(':');
    if (colon <= 0) {
      log(`Skipping malformed POOL_DISCOVERY_SEED_ADDRESSES entry "${t}" (expected chainId:0xADDR)`);
      continue;
    }
    const chainId = Number.parseInt(t.slice(0, colon), 10);
    const address = t.slice(colon + 1);
    if (!Number.isFinite(chainId) || chainId <= 0 || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      log(`Skipping malformed POOL_DISCOVERY_SEED_ADDRESSES entry "${t}"`);
      continue;
    }
    // Address is a branded template literal type (`0x${string}`); the regex above already
    // constrained the shape, so the cast here is the canonical escape hatch. Disable the
    // lint rule inline — the assertion DOES change the type from `string` to `0x${string}`.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    out.push({ chainId: chainId as ChainId, address: address as Address });
  }
  return out.length > 0 ? out : DEFAULT_SEED_POOLS;
}

/**
 * Pool Discovery Service
 * Step: DEX-1-0-POOL-DISCOVERY
 *
 * Discovers DEX liquidity pools from on-chain factory contracts.
 * Uses Redis-compatible in-memory cache with configurable TTL.
 *
 * Warm-up (fix for workaround #6 — Hermes hardcoded 8 pools in PriceOracle
 * because the cache was always empty after restart):
 *   - On startup, asynchronously discover the seed pools (default + env override).
 *   - The discovery loop (when enabled) re-discovers seeds every tick so reserves
 *     stay current and don't silently expire into null.
 *   - Warm-up is fire-and-forget so it doesn't block module init; first pricing
 *     reads that race the warm-up will still miss, but every subsequent call hits
 *     a populated cache.
 */
@Injectable()
export class PoolDiscoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PoolDiscoveryService.name);

  // In-memory pool cache (Redis in production, Map for now)
  private readonly poolCache = new Map<Address, PoolCacheEntry>();
  private readonly CACHE_TTL_MS = 300_000; // 5 minutes default
  private discoveryTimer?: NodeJS.Timeout;
  private readonly DISCOVERY_INTERVAL_MS = 60_000; // 1 minute

  private readonly seedPools: SeedPoolEntry[];

  // Metrics
  private discoveredPoolsGauge!: Gauge<string>;
  private discoveryLatencyHistogram!: Histogram<string>;
  private cacheHitCounter!: Counter<string>;
  private cacheMissCounter!: Counter<string>;

  constructor(private readonly rpcProviderManager: RpcProviderManager) {
    this.seedPools = loadSeedPools((m) => this.logger.warn(m));
  }

  onModuleInit() {
    this.initializeMetrics();
    this.logger.log(
      `Pool Discovery Service initialized (seeds: ${this.seedPools.length} pool(s))`,
    );

    // Warm-up: fire-and-forget discovery of seed pools. Does NOT block module init —
    // the cache fills as RPC responds; calls that race it will miss and fail-closed
    // (the next call after warm-up completes hits the cache).
    void this.warmUpSeedPools();

    if (process.env.POOL_DISCOVERY_ENABLED === 'true') {
      this.startDiscoveryLoop();
    }
  }

  /**
   * Discover seed pools once on startup. Failures are logged and swallowed —
   * warm-up is best-effort and must never break module init.
   */
  private async warmUpSeedPools(): Promise<void> {
    if (this.seedPools.length === 0) return;
    const start = Date.now();
    let ok = 0;
    for (const seed of this.seedPools) {
      try {
        const pool = await this.discoverPool(seed.chainId, seed.address);
        if (pool !== null) ok++;
      } catch (err) {
        this.logger.warn(
          `Seed pool warm-up failed for ${seed.address} (chain ${seed.chainId}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.logger.log(
      `Seed pool warm-up done: ${ok}/${this.seedPools.length} discovered in ${Date.now() - start}ms`,
    );
  }

  onModuleDestroy() {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
    }
  }

  /** Clear all cached pools (test hook). */
  clearCacheForTest(): void {
    this.poolCache.clear();
  }

  /**
   * Get pool from cache or discover on-chain
   */
  async getPool(chainId: ChainId, poolAddress: Address): Promise<DiscoveredPool | null> {
    const cached = this.poolCache.get(poolAddress);
    if (cached && cached.expiresAt > Date.now()) {
      this.cacheHitCounter.inc({ chain_id: String(chainId) });
      return cached.pool;
    }

    this.cacheMissCounter.inc({ chain_id: String(chainId) });
    return this.discoverPool(chainId, poolAddress);
  }

  /**
   * Get all cached pools for a chain
   */
  getCachedPools(chainId: ChainId): DiscoveredPool[] {
    const now = Date.now();
    const pools: DiscoveredPool[] = [];

    for (const [, entry] of this.poolCache) {
      if (entry.expiresAt > now && entry.pool.chainId === chainId) {
        pools.push(entry.pool);
      }
    }

    return pools;
  }

  /**
   * Discover a single pool on-chain
   */
  private async discoverPool(chainId: ChainId, poolAddress: Address): Promise<DiscoveredPool | null> {
    const startTime = Date.now();

    try {
      const provider = this.rpcProviderManager.getProvider(chainId) as JsonRpcProvider;

      // Try UniV2-style pool (getReserves)
      const pool = await this.tryUniV2Pool(provider, chainId, poolAddress);
      if (pool) {
        this.cachePool(pool);
        this.recordLatency(startTime, chainId);
        return pool;
      }

      // Try UniV3-style pool (slot0 + liquidity)
      const v3Pool = await this.tryUniV3Pool(provider, chainId, poolAddress);
      if (v3Pool) {
        this.cachePool(v3Pool);
        this.recordLatency(startTime, chainId);
        return v3Pool;
      }

      this.logger.warn(`Pool ${poolAddress} not recognized on chain ${chainId}`);
      return null;
    } catch (error) {
      this.logger.error(`Failed to discover pool ${poolAddress} on chain ${chainId}:`, error);
      this.recordLatency(startTime, chainId);
      return null;
    }
  }

  /**
   * Try to read pool as UniV2/Sushi style
   */
  private async tryUniV2Pool(
    provider: JsonRpcProvider,
    chainId: ChainId,
    poolAddress: Address,
  ): Promise<DiscoveredPool | null> {
    try {
      const abi = [
        'function token0() view returns (address)',
        'function token1() view returns (address)',
        'function getReserves() view returns (uint112, uint112, uint32)',
        'function factory() view returns (address)',
      ];

      const contract = new Contract(poolAddress, abi, provider) as unknown as UniV2PoolContract;
      const [token0, token1, reserves, factory, blockNumber] = await Promise.all([
        contract.token0(),
        contract.token1(),
        contract.getReserves(),
        contract.factory().catch(() => null),
        provider.getBlockNumber(),
      ]);

      // ethers v6 returns getReserves() as bigint tuple already — wrapping with BigInt()
      // throws "Cannot mix BigInt and other types" because the operand is already bigint.
      // The typeof guard narrows to bigint in the true branch; the false branch converts
      // whatever fallback type ethers declared (number | string) via BigInt().
      const r0 = reserves[0];
      const r1 = reserves[1];
      const reserve0 = typeof r0 === 'bigint' ? r0 : BigInt(r0);
      const reserve1 = typeof r1 === 'bigint' ? r1 : BigInt(r1);

      return {
        address: poolAddress,
        token0: token0 as Address,
        token1: token1 as Address,
        feeBps: 30, // Default 0.3% for UniV2
        reserve0,
        reserve1,
        chainId,
        factory: (factory || '0x0000000000000000000000000000000000000000') as Address,
        protocol: 'uniswap-v2',
        blockNumber,
        discoveredAt: new Date(),
      };
    } catch (e) {
      this.logger.debug(
        `tryUniV2Pool failed for ${poolAddress} (chain ${chainId}): ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * Try to read pool as UniV3 style
   */
  private async tryUniV3Pool(
    provider: JsonRpcProvider,
    chainId: ChainId,
    poolAddress: Address,
  ): Promise<DiscoveredPool | null> {
    try {
      const abi = [
        'function token0() view returns (address)',
        'function token1() view returns (address)',
        'function fee() view returns (uint24)',
        'function slot0() view returns (uint160, int24, uint16, uint16, uint16, uint8, bool)',
        'function liquidity() view returns (uint128)',
        'function factory() view returns (address)',
      ];

      const contract = new Contract(poolAddress, abi, provider) as unknown as UniV3PoolContract;
      const [token0, token1, fee, factory, blockNumber, liquidity, slot0] = await Promise.all([
        contract.token0(),
        contract.token1(),
        contract.fee(),
        contract.factory().catch(() => null),
        provider.getBlockNumber(),
        contract.liquidity(),
        contract.slot0(),
      ]);

      // V3 price is encoded in slot0.sqrtPriceX96; `liquidity` is not a price and is kept
      // in reserve0/reserve1 only for cache-shape compatibility (callers MUST use
      // sqrtPriceX96 for V3 pricing via v3Price() from @arbibot/contracts-eth).
      const sqrtPriceX96 = slot0[0];

      return {
        address: poolAddress,
        token0: token0 as Address,
        token1: token1 as Address,
        feeBps: Number(fee) / 100,
        reserve0: BigInt(liquidity),
        reserve1: BigInt(liquidity),
        sqrtPriceX96,
        chainId,
        factory: (factory || '0x0000000000000000000000000000000000000000') as Address,
        protocol: 'uniswap-v3',
        blockNumber,
        discoveredAt: new Date(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Cache a discovered pool
   */
  private cachePool(pool: DiscoveredPool): void {
    const ttlMs = parseInt(process.env.POOL_CACHE_TTL_MS || String(this.CACHE_TTL_MS), 10);
    this.poolCache.set(pool.address, {
      pool,
      expiresAt: Date.now() + ttlMs,
    });
    this.discoveredPoolsGauge.set({ chain_id: String(pool.chainId) }, this.poolCache.size);
  }

  /**
   * Start periodic discovery loop. Re-discovers seed pools on every tick so their
   * reserves stay current (the TTL would otherwise silently null them out and
   * break priceArbitraryViaPool mid-run), then sweeps expired entries.
   */
  private startDiscoveryLoop(): void {
    const intervalMs = parseInt(process.env.POOL_DISCOVERY_INTERVAL_MS || String(this.DISCOVERY_INTERVAL_MS), 10);

    this.discoveryTimer = setInterval(() => {
      // Re-discover seeds first (best-effort; failures are logged inside discoverPool).
      void Promise.all(
        this.seedPools.map(async (seed) => {
          try {
            await this.discoverPool(seed.chainId, seed.address);
          } catch {
            // Swallow — keep the loop alive. discoverPool already logged the error.
          }
        }),
      ).then(() => {
        this.cleanupExpiredEntries();
      });
    }, intervalMs);

    this.discoveryTimer.unref?.();
    this.logger.log(
      `Pool discovery loop started (interval: ${intervalMs}ms, seeds: ${this.seedPools.length})`,
    );
  }

  /**
   * Cleanup expired cache entries
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let expired = 0;

    for (const [key, entry] of this.poolCache) {
      if (entry.expiresAt <= now) {
        this.poolCache.delete(key);
        expired++;
      }
    }

    if (expired > 0) {
      this.logger.debug(`Cleaned up ${expired} expired pool cache entries`);
    }
  }

  /**
   * Record discovery latency metric
   */
  private recordLatency(startTime: number, chainId: ChainId): void {
    const elapsed = (Date.now() - startTime) / 1000;
    this.discoveryLatencyHistogram.observe({ chain_id: String(chainId) }, elapsed);
  }

  /**
   * Initialize Prometheus metrics
   */
  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    try {
      this.discoveredPoolsGauge = new Gauge({
        name: 'arb_dex_pools_discovered',
        help: 'Number of discovered DEX pools in cache',
        labelNames: ['chain_id'],
        registers: [registry],
      });
    } catch {
      // Metric already registered (shared registry in tests)
    }

    try {
      this.discoveryLatencyHistogram = new Histogram({
        name: 'arb_dex_pool_discovery_latency_seconds',
        help: 'Pool discovery latency in seconds',
        labelNames: ['chain_id'],
        buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
        registers: [registry],
      });
    } catch {
      // Metric already registered
    }

    try {
      this.cacheHitCounter = new Counter({
        name: 'arb_dex_pool_cache_hits_total',
        help: 'Pool cache hit count',
        labelNames: ['chain_id'],
        registers: [registry],
      });
    } catch {
      // Metric already registered
    }

    try {
      this.cacheMissCounter = new Counter({
        name: 'arb_dex_pool_cache_misses_total',
        help: 'Pool cache miss count',
        labelNames: ['chain_id'],
        registers: [registry],
      });
    } catch {
      // Metric already registered
    }
  }
}