import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { JsonRpcProvider, Contract } from 'ethers';
import { Counter, Gauge, Histogram } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';
import { ChainId, Address } from '@arbibot/contracts-eth';

/**
 * Discovered DEX pool
 */
export interface DiscoveredPool {
  address: Address;
  token0: Address;
  token1: Address;
  feeBps: number;
  reserve0: bigint;
  reserve1: bigint;
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
 * Pool Discovery Service
 * Step: DEX-1-0-POOL-DISCOVERY
 *
 * Discovers DEX liquidity pools from on-chain factory contracts.
 * Uses Redis-compatible in-memory cache with configurable TTL.
 */
@Injectable()
export class PoolDiscoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PoolDiscoveryService.name);

  // In-memory pool cache (Redis in production, Map for now)
  private readonly poolCache = new Map<Address, PoolCacheEntry>();
  private readonly CACHE_TTL_MS = 300_000; // 5 minutes default
  private discoveryTimer?: NodeJS.Timeout;
  private readonly DISCOVERY_INTERVAL_MS = 60_000; // 1 minute

  // Metrics
  private discoveredPoolsGauge!: Gauge<string>;
  private discoveryLatencyHistogram!: Histogram<string>;
  private cacheHitCounter!: Counter<string>;
  private cacheMissCounter!: Counter<string>;

  constructor(private readonly rpcProviderManager: RpcProviderManager) {}

  onModuleInit() {
    this.initializeMetrics();
    this.logger.log('Pool Discovery Service initialized');

    if (process.env.POOL_DISCOVERY_ENABLED === 'true') {
      this.startDiscoveryLoop();
    }
  }

  onModuleDestroy() {
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
    }
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

      const contract = new Contract(poolAddress, abi, provider) as any;
      const [token0, token1, reserves, factory, blockNumber] = await Promise.all([
        contract.token0(),
        contract.token1(),
        contract.getReserves(),
        contract.factory().catch(() => null),
        provider.getBlockNumber(),
      ]);

      return {
        address: poolAddress,
        token0: token0 as Address,
        token1: token1 as Address,
        feeBps: 30, // Default 0.3% for UniV2
        reserve0: BigInt(reserves[0]),
        reserve1: BigInt(reserves[1]),
        chainId,
        factory: (factory || '0x0000000000000000000000000000000000000000') as Address,
        protocol: 'uniswap-v2',
        blockNumber,
        discoveredAt: new Date(),
      };
    } catch {
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

      const contract = new Contract(poolAddress, abi, provider) as any;
      const [token0, token1, fee, factory, blockNumber] = await Promise.all([
        contract.token0(),
        contract.token1(),
        contract.fee(),
        contract.factory().catch(() => null),
        provider.getBlockNumber(),
      ]);

      // For V3, reserves are represented as liquidity + slot0
      const liquidity = await contract.liquidity();

      return {
        address: poolAddress,
        token0: token0 as Address,
        token1: token1 as Address,
        feeBps: Number(fee) / 100,
        reserve0: BigInt(liquidity),
        reserve1: BigInt(liquidity),
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
   * Start periodic discovery loop
   */
  private startDiscoveryLoop(): void {
    const intervalMs = parseInt(process.env.POOL_DISCOVERY_INTERVAL_MS || String(this.DISCOVERY_INTERVAL_MS), 10);

    this.discoveryTimer = setInterval(() => {
      this.cleanupExpiredEntries();
    }, intervalMs);

    this.discoveryTimer.unref?.();
    this.logger.log(`Pool discovery loop started (interval: ${intervalMs}ms)`);
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

    this.discoveredPoolsGauge = new Gauge({
      name: 'arb_dex_pools_discovered',
      help: 'Number of discovered DEX pools in cache',
      labelNames: ['chain_id'],
      registers: [registry],
    });

    this.discoveryLatencyHistogram = new Histogram({
      name: 'arb_dex_pool_discovery_latency_seconds',
      help: 'Pool discovery latency in seconds',
      labelNames: ['chain_id'],
      buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [registry],
    });

    this.cacheHitCounter = new Counter({
      name: 'arb_dex_pool_cache_hits_total',
      help: 'Pool cache hit count',
      labelNames: ['chain_id'],
      registers: [registry],
    });

    this.cacheMissCounter = new Counter({
      name: 'arb_dex_pool_cache_misses_total',
      help: 'Pool cache miss count',
      labelNames: ['chain_id'],
      registers: [registry],
    });
  }
}