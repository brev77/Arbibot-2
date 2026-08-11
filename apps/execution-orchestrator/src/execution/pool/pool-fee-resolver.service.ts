import { Injectable, Logger } from '@nestjs/common';
import { Contract, ZeroAddress, type JsonRpcProvider } from 'ethers';
import { Address, ChainId, getArbitrumAddresses, getBaseAddresses, getBnbAddresses } from '@arbibot/contracts-eth';

import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';

/**
 * PoolFeeResolverService (FIX-D, 2026-08-11).
 *
 * Resolves the Uniswap V3 pool fee tier with the highest on-chain `liquidity()` for a
 * given token pair. Replaces the hardcoded `fee: 500` in the plan-builder, which selected
 * the THIN pool for 2/4 verified pairs (CRV/WETH fee=500 liquidity is ~3000× lower than
 * fee=3000, so swaps routed through it reverted or yielded ~44× less output).
 *
 * Strategy: for each of the canonical V3 fee tiers [100, 500, 3000, 10000], call
 * `factory.getPool(tokenA, tokenB, fee)`; if the pool exists, read `pool.liquidity()`;
 * return the fee tier with the highest liquidity. Result is cached per (chain, tokenA,
 * tokenB) key for `CACHE_TTL_MS` (default 5 min) — pool liquidity moves slowly relative
 * to the plan-creation rate, and this avoids 4 RPC calls on every plan.
 *
 * Fail-soft: on any RPC error, returns `DEFAULT_FEE_TIER` (3000) — safer than 500 for
 * long-tail pairs, and matches the adapter's existing DEFAULT_FEE fallback.
 */
const CACHE_TTL_MS = 5 * 60_000;
const V3_FEE_TIERS = [100, 500, 3000, 10000] as const;
const DEFAULT_FEE_TIER = 3000;

const FACTORY_ABI = [
  'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)',
] as const;
const POOL_ABI = ['function liquidity() view returns (uint128)'] as const;

interface CacheEntry {
  readonly fee: number;
  readonly expiresAt: number;
}

function resolveFactoryAddress(chainId: number): Address | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- ChainId is a type alias over number; eslint sees the cast as redundant, but tsc needs it for the getArbitrumAddresses(chainId: ChainId) signature.
    const id = chainId as ChainId;
    // Arbitrum
    if (chainId === 42161 || chainId === 421611 || chainId === 421614) {
      return getArbitrumAddresses(id).uniswapV3Factory;
    }
    // Base
    if (chainId === 8453 || chainId === 84532) {
      return getBaseAddresses(id).uniswapV3Factory;
    }
    // BNB Chain
    if (chainId === 56 || chainId === 97) {
      return getBnbAddresses(id).uniswapV3Factory;
    }
    return null;
  } catch {
    return null;
  }
}

@Injectable()
export class PoolFeeResolverService {
  private readonly logger = new Logger(PoolFeeResolverService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly rpcProviderManager: RpcProviderManager) {}

  /**
   * Resolve the V3 fee tier with the highest `liquidity()` for the pair.
   * Returns `DEFAULT_FEE_TIER` (3000) on any error or when no pool exists.
   * `tokenA`/`tokenB` order does not matter (factory.getPool is symmetric).
   */
  async resolveBestFeeTier(
    chainId: number,
    tokenA: Address,
    tokenB: Address,
  ): Promise<number> {
    const a = tokenA.toLowerCase();
    const b = tokenB.toLowerCase();
    // Canonical cache key: lexicographically smaller address first (order-independent).
    const key = `${chainId}:${a < b ? a : b}:${a < b ? b : a}`;
    const cached = this.cache.get(key);
    if (cached !== undefined && cached.expiresAt > Date.now()) {
      return cached.fee;
    }

    const factoryAddress = resolveFactoryAddress(chainId);
    if (factoryAddress === null) {
      this.logger.debug(`no V3 factory for chain ${chainId} → default ${DEFAULT_FEE_TIER}`);
      return DEFAULT_FEE_TIER;
    }

    let provider: JsonRpcProvider;
    try {
      provider = this.rpcProviderManager.getProvider(chainId) as JsonRpcProvider;
    } catch (err) {
      this.logger.warn(
        `resolveBestFeeTier: no provider for chain ${chainId}: ${err instanceof Error ? err.message : String(err)} → default ${DEFAULT_FEE_TIER}`,
      );
      return DEFAULT_FEE_TIER;
    }

    const factory = new Contract(factoryAddress, FACTORY_ABI, provider) as unknown as {
      getPool(tokenA: string, tokenB: string, fee: number): Promise<string>;
    };
    let bestFee = DEFAULT_FEE_TIER;
    let bestLiquidity = 0n;

    for (const fee of V3_FEE_TIERS) {
      try {
        const poolAddr = await factory.getPool(a, b, fee);
        if (poolAddr === ZeroAddress) {
          continue;
        }
        const pool = new Contract(poolAddr, POOL_ABI, provider) as unknown as {
          liquidity(): Promise<bigint>;
        };
        const liquidity = await pool.liquidity();
        if (liquidity > bestLiquidity) {
          bestLiquidity = liquidity;
          bestFee = fee;
        }
      } catch (err) {
        // Per-tier RPC error — skip this tier, keep checking the rest. A partial result
        // (some tiers read) is better than failing outright; we still pick the best of
        // what we could read. Only the full-RPC-down case falls back to DEFAULT_FEE_TIER.
        this.logger.debug(
          `resolveBestFeeTier: tier ${fee} read failed for ${a}/${b} on chain ${chainId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.cache.set(key, { fee: bestFee, expiresAt: Date.now() + CACHE_TTL_MS });
    return bestFee;
  }
}
