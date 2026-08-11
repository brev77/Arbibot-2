import { Injectable, Logger } from '@nestjs/common';
import { Contract } from 'ethers';
import {
  Address,
  ChainId,
  ZERO_ADDRESS,
  getArbitrumAddresses,
  getBaseAddresses,
  getBnbAddresses,
} from '@arbibot/contracts-eth';

import { RpcProviderManager } from './rpc/rpc-provider-manager.service';

/**
 * Minimal V2 router surface used for `getAmountsOut` (read-only spot quote).
 * Shared by UniswapV2 / Sushi / PancakeV2 / Biswap routers (all expose the same
 * `IUniswapV2Router02.getAmountsOut` view).
 */
const V2_ROUTER_ABI = [
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
] as const;

/** Typed V2 router surface (ethers Contract methods are dynamic; this pins the call). */
interface V2RouterContract {
  getAmountsOut(amountIn: bigint, path: readonly string[]): Promise<bigint[]>;
}

/**
 * V2 DEX venue keys handled by this service. All use the UniswapV2-family router
 * `getAmountsOut` view; only the router address differs per venue/chain.
 */
export type V2VenueKey = 'uniswap-v2' | 'sushiswap' | 'pancakeswap-v2' | 'biswap';

export const V2_VENUE_KEYS: ReadonlySet<string> = new Set<string>([
  'uniswap-v2',
  'sushiswap',
  'pancakeswap-v2',
  'biswap',
]);

/**
 * Resolve the V2-family router address for a venue on a chain, or `ZERO_ADDRESS`
 * when the venue is not deployed there. Mirrors the per-adapter resolvers
 * (`resolveSushiRouterAddress`, `resolvePancakeV2RouterAddress`, …) but collects
 * them into one canonical lookup so the cost/quote path does not depend on
 * adapter internals.
 */
export function resolveV2RouterAddress(chainId: ChainId, venueKey: string): Address {
  if (
    chainId === (42161 as ChainId) ||
    chainId === (421611 as ChainId) ||
    chainId === (421614 as ChainId)
  ) {
    const a = getArbitrumAddresses(chainId);
    // On Arbitrum there is no standalone Uniswap V2 — both keys route to Sushi.
    if (venueKey === 'sushiswap' || venueKey === 'uniswap-v2') return a.sushiSwapRouter;
    return ZERO_ADDRESS;
  }
  if (chainId === (8453 as ChainId) || chainId === (84532 as ChainId)) {
    const a = getBaseAddresses(chainId);
    if (venueKey === 'sushiswap') return a.sushiSwapRouter;
    if (venueKey === 'uniswap-v2') return a.uniswapV2Router;
    return ZERO_ADDRESS;
  }
  if (chainId === (56 as ChainId) || chainId === (97 as ChainId)) {
    const a = getBnbAddresses(chainId);
    if (venueKey === 'sushiswap') return a.sushiSwapRouter;
    if (venueKey === 'pancakeswap-v2') return a.pancakeV2Router;
    if (venueKey === 'biswap') return a.biswapV2Router;
    return ZERO_ADDRESS;
  }
  return ZERO_ADDRESS;
}

/**
 * V2QuoterService — authoritative UniswapV2-family price quote (read-only).
 *
 * Wraps `router.getAmountsOut(amountIn, [tokenIn, tokenOut])` so callers get the
 * REALIZED `amountOut` for a given `amountIn` at the current pool state, without
 * broadcasting. Used by the pre-trade round-trip profitability gate (P1) and the
 * cost estimator to value V2/Sushi legs authoritatively — replacing the
 * constant-product mid-price estimate that produced phantom spreads.
 *
 * Capital safety: strictly read-only — `getAmountsOut` is a `view`. Any failure
 * (RPC down, unsupported venue/chain, zero/invalid output, no liquidity) resolves
 * to `null` so the caller can fail-closed to a skip rather than guessing.
 */
@Injectable()
export class V2QuoterService {
  private readonly logger = new Logger(V2QuoterService.name);

  constructor(private readonly rpcProviderManager: RpcProviderManager) {}

  /**
   * Quote a single-hop V2 swap `tokenIn → tokenOut`.
   *
   * @returns the expected `amountOut` (bigint, smallest token units), or `null`
   *   when the quote cannot be obtained (unsupported venue/chain, RPC error,
   *   insufficient liquidity / revert). Never throws.
   */
  async quoteExactTokensForTokens(
    chainId: ChainId,
    venueKey: string,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
  ): Promise<bigint | null> {
    if (!V2_VENUE_KEYS.has(venueKey)) {
      return null;
    }
    const routerAddress = resolveV2RouterAddress(chainId, venueKey);
    if (routerAddress === ZERO_ADDRESS) {
      return null;
    }
    try {
      const provider = this.rpcProviderManager.getProvider(chainId);
      const router = new Contract(routerAddress, V2_ROUTER_ABI, provider) as unknown as V2RouterContract;
      const amounts = await router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
      const amountOut = Array.isArray(amounts) ? amounts[amounts.length - 1] : undefined;
      if (amountOut === undefined || amountOut <= 0n) {
        return null;
      }
      return amountOut;
    } catch (e) {
      this.logger.debug(
        `V2 getAmountsOut failed for chain ${chainId} venue=${venueKey} (${tokenIn}→${tokenOut} amountIn=${amountIn}): ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }
}
