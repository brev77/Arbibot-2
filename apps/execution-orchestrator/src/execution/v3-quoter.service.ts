import { Injectable, Logger } from '@nestjs/common';
import { Contract } from 'ethers';
import {
  Address,
  ChainId,
  ZERO_ADDRESS,
  QuoterV2ABI,
  getArbitrumAddresses,
  getBaseAddresses,
  getBnbAddresses,
} from '@arbibot/contracts-eth';

import { RpcProviderManager } from './rpc/rpc-provider-manager.service';

/**
 * Minimal QuoterV2 surface used for `quoteExactInputSingle`.
 *
 * Exported so other services (e.g. the cost estimator) can share the exact
 * typing the adapter uses. The UniswapV3Adapter keeps its own private copy for
 * now; a follow-up should consolidate `quoteV3` onto this service.
 */
export type QuoteExactInputSingleArgs = {
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amountIn: bigint;
  readonly fee: number;
  readonly sqrtPriceLimitX96: bigint;
};
export type QuoteExactInputSingleResult = [bigint, bigint, number, bigint];

// FIX-B (2026-08-11): the contract method is exposed as an object with a
// `.staticCall` member (ethers v6 idiom for routing `nonpayable` functions
// through `eth_call`). Declaring it as a callable-plus-staticCall shape lets
// us call `quoter.quoteExactInputSingle.staticCall(...)` with full typing.
export interface QuoterV2Contract {
  quoteExactInputSingle: {
    (params: QuoteExactInputSingleArgs): Promise<QuoteExactInputSingleResult>;
    staticCall(params: QuoteExactInputSingleArgs): Promise<QuoteExactInputSingleResult>;
  };
}

/**
 * Resolve the QuoterV2 address for a chain, or `ZERO_ADDRESS` on chains/testnets
 * where it is not deployed. Callers treat `ZERO_ADDRESS` as "quote unavailable".
 *
 * Mirrors the adapter's private `resolveQuoterV2Address` — kept here as the
 * canonical resolver so the cost path does not depend on adapter internals.
 */
export function resolveQuoterV2Address(chainId: ChainId): Address {
  if (
    chainId === (42161 as ChainId) ||
    chainId === (421611 as ChainId) ||
    chainId === (421614 as ChainId)
  ) {
    return getArbitrumAddresses(chainId).quoterV2;
  }
  if (chainId === (8453 as ChainId) || chainId === (84532 as ChainId)) {
    return getBaseAddresses(chainId).quoterV2;
  }
  if (chainId === (56 as ChainId) || chainId === (97 as ChainId)) {
    return getBnbAddresses(chainId).quoterV2;
  }
  return ZERO_ADDRESS;
}

/**
 * V3QuoterService — authoritative Uniswap V3 price quote (read-only).
 *
 * Wraps `QuoterV2.quoteExactInputSingle.staticCall` so callers get the REALIZED
 * `amountOut` for a given `amountIn` at the current pool state, without
 * broadcasting. Used by the pre-trade cost estimator (FIX-F) to compute true
 * price impact on V3 pools — replacing the V2 constant-product estimate that
 * is meaningless on V3 pools (where `DiscoveredPool.reserve0/1` carry
 * `liquidity`, not a price).
 *
 * Capital safety: this service is strictly read-only — `staticCall` routes
 * through `eth_call` and can never submit a transaction. Any failure (RPC down,
 * unsupported chain, zero/invalid output) resolves to `null` so the caller can
 * fail-soft to a modeled estimate rather than silently widening slippage.
 */
@Injectable()
export class V3QuoterService {
  private readonly logger = new Logger(V3QuoterService.name);

  constructor(private readonly rpcProviderManager: RpcProviderManager) {}

  /**
   * Quote `quoteExactInputSingle` for a V3 swap.
   *
   * @returns the expected `amountOut` (bigint, smallest token units), or `null`
   *   when the quote cannot be obtained (unsupported chain, RPC error, zero
   *   output). Never throws.
   */
  async quoteExactInputSingle(
    chainId: ChainId,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    fee: number,
  ): Promise<bigint | null> {
    const quoterAddress = resolveQuoterV2Address(chainId);
    if (quoterAddress === ZERO_ADDRESS) {
      return null;
    }
    try {
      const provider = this.rpcProviderManager.getProvider(chainId);
      const quoter = new Contract(
        quoterAddress,
        QuoterV2ABI,
        provider,
      ) as unknown as QuoterV2Contract;
      // FIX-B (2026-08-11): QuoterV2.quoteExactInputSingle is
      // `stateMutability: 'nonpayable'` (the contract reverts-and-catches to
      // return the quote). Calling it directly makes ethers v6 attempt a
      // `sendTransaction`, which a read-only provider cannot do.
      // `.staticCall()` routes through `eth_call` so the quote resolves without
      // a broadcast.
      const result = await quoter.quoteExactInputSingle.staticCall({
        tokenIn,
        tokenOut,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      });
      const amountOut = result[0];
      if (amountOut === undefined || amountOut <= 0n) {
        return null;
      }
      return amountOut;
    } catch (e) {
      this.logger.debug(
        `QuoterV2 quote failed for chain ${chainId} (${tokenIn}→${tokenOut} fee=${fee} amountIn=${amountIn}): ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }
}
