import { Controller, Get } from '@nestjs/common';

import { DexHealthService } from './dex-health.service';

/**
 * DEX Health Controller
 * Step: DEX-1-2-HEALTH
 *
 * Exposes DEX infrastructure health status endpoints:
 * - GET /health/dex — comprehensive DEX health (RPC, Vault, Wallet, Mempool)
 * - GET /health/bridges — bridge health stub (DEX-2)
 */
@Controller('health')
export class DexHealthController {
  constructor(private readonly dexHealthService: DexHealthService) {}

  @Get('dex')
  getDexHealth() {
    return this.dexHealthService.getDexHealth();
  }

  @Get('bridges')
  getBridgeHealth() {
    return this.dexHealthService.getBridgeHealth();
  }
}