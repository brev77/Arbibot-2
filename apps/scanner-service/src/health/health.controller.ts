import { Controller, Get } from '@nestjs/common';

import { ScannerRpcService } from '../scanner/scanner-rpc.service';

/**
 * Service-specific health probes for scanner-service.
 *
 * The base `GET /health`, `GET /health/live`, `GET /health/ready` endpoints are owned by the
 * shared `@Global() HealthModule` from `@arbibot/nest-platform` (registered first in AppModule).
 * This controller only owns service-specific probes to avoid a route conflict on `GET /health`.
 * Pattern mirrors apps/market-intake-service/src/health/health.controller.ts.
 */
@Controller()
export class HealthController {
  constructor(private readonly rpc: ScannerRpcService) {}

  /**
   * Per-chain RPC provider health: latency, block number, rate-budget headroom.
   * Used by the operator UI / Hermes to see which chains the scanner can actually reach.
   */
  @Get('health/rpc')
  rpcStatus() {
    return this.rpc.getAllHealthStatus();
  }
}
