import { Controller, Get, Post, Param, Query } from '@nestjs/common';

import { PaperDiscoveryService } from './paper-discovery.service';
import { PaperDiscoveryWorker } from './paper-discovery-worker';

/**
 * Paper Discovery Controller (P3-4)
 *
 * Provides operator endpoints for:
 * - Listing discovery candidates
 * - Triggering discovery cycles manually (testing)
 * - Getting worker status
 *
 * Note: enqueue endpoint removed to maintain paper isolation.
 * Discovery creates paper trades directly via PaperTradesService.
 */
@Controller('paper-discovery')
export class PaperDiscoveryController {
  constructor(
    private readonly discoveryService: PaperDiscoveryService,
    private readonly worker: PaperDiscoveryWorker,
  ) {}

  /**
   * List discovery candidates
   * GET /paper-discovery/candidates?status=&limit=
   */
  @Get('candidates')
  async list(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit !== undefined ? Math.min(500, Math.max(1, Number(limit))) : 100;
    return this.discoveryService.list(status, parsedLimit);
  }

  /**
   * Trigger discovery cycle manually (testing)
   * POST /paper-discovery/trigger
   */
  @Post('trigger')
  async trigger() {
    return this.worker.triggerDiscovery();
  }

  /**
   * Get worker status
   * GET /paper-discovery/status
   */
  @Get('status')
  getStatus() {
    return this.worker.getStatus();
  }

  /**
   * Get discovery configuration
   * GET /paper-discovery/config
   */
  @Get('config')
  getConfig() {
    return this.discoveryService.getConfig();
  }

  /**
   * Reject a candidate (operator action)
   * POST /paper-discovery/candidates/:id/reject
   *
   * Allows operators to reject candidates after manual review
   * Updates status to 'rejected' with audit logging
   */
  @Post('candidates/:id/reject')
  async rejectCandidate(
    @Param('id') id: string,
    @Query('operatorId') operatorId?: string,
  ) {
    const effectiveOperatorId =
      operatorId || process.env.ARBIBOT_DEV_OPERATOR_ID || 'system';

    const result = await this.discoveryService.rejectCandidate(
      id,
      effectiveOperatorId,
    );

    return result;
  }
}
