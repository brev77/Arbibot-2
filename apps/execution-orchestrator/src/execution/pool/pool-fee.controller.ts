import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { Address } from '@arbibot/contracts-eth';

import { PoolFeeResolverService } from './pool-fee-resolver.service';

/**
 * Pool Fee Controller (FIX-D, 2026-08-11).
 *
 * Read-only endpoint exposing `PoolFeeResolverService.resolveBestFeeTier` to peer
 * services. The primary consumer is the opportunity-service `LiveAutoDriveWorker`,
 * which needs the most-liquid V3 fee tier for a pair before building the plan body —
 * replacing the hardcoded `fee: 500` that routed CRV/WETH swaps through a thin pool
 * (~3000× less liquidity than fee=3000) and caused reverts / ~44× less output.
 *
 * No auth guard — matches every other EO controller (platform-level HTTP security only).
 * HTTP 200 returns `{ chainId, tokenA, tokenB, fee }`; on RPC failure or unknown chain
 * the resolver returns `DEFAULT_FEE_TIER` (3000) rather than throwing, so the caller
 * always gets a usable fee tier (fail-soft, never blocks plan creation).
 */
@Controller('execution/pool')
export class PoolFeeController {
  constructor(private readonly poolFeeResolver: PoolFeeResolverService) {}

  @Get('best-fee/:chainId/:tokenA/:tokenB')
  async getBestFeeTier(
    @Param('chainId', new ParseIntPipe()) chainId: number,
    @Param('tokenA') tokenA: Address,
    @Param('tokenB') tokenB: Address,
  ): Promise<{ chainId: number; tokenA: string; tokenB: string; fee: number }> {
    const fee = await this.poolFeeResolver.resolveBestFeeTier(chainId, tokenA, tokenB);
    return {
      chainId,
      tokenA: tokenA.toLowerCase(),
      tokenB: tokenB.toLowerCase(),
      fee,
    };
  }
}
