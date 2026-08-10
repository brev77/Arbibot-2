import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { Address } from '@arbibot/contracts-eth';

import { PriceOracleService } from './price-oracle.service';

/**
 * Price Controller (PLAN12 #48 — `FUNC-AMOUNTIN-USD-ORACLE`).
 *
 * Read-only endpoint exposing `PriceOracleService.getTokenPriceUsd` to peer services.
 * The primary consumer is the opportunity-service `LivePriceClientService`, which needs
 * the USD price of the quote token (token1) to convert `notionalUsd` into correct
 * `amountIn` raw units (fix for the `notionalUsd × 10^decimals` bug that assumed every
 * quote token was a $1 stablecoin). See `docs/plan-amountin-usd-oracle-2026-08-10.md`.
 *
 * No auth guard — matches every other EO controller (platform-level HTTP security only).
 * `priceUsd` may be `null` (oracle fail-closed) and is returned as HTTP 200 with a JSON
 * `null`, matching the service contract — callers decide how to handle the absence.
 */
@Controller('execution/price')
export class PriceController {
  constructor(private readonly priceOracle: PriceOracleService) {}

  @Get(':chainId/:tokenAddress')
  async getPrice(
    @Param('chainId', new ParseIntPipe()) chainId: number,
    @Param('tokenAddress') tokenAddress: Address,
  ): Promise<{ chainId: number; tokenAddress: string; priceUsd: number | null }> {
    const priceUsd = await this.priceOracle.getTokenPriceUsd(chainId, tokenAddress);
    return { chainId, tokenAddress: tokenAddress.toLowerCase(), priceUsd };
  }
}
