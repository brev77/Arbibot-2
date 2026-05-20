import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { CrossChainReconciliationService } from './cross-chain-reconciliation.service';

/**
 * Bridge reconciliation HTTP API.
 *
 * Step: DEX-2-3-RECON-XCHAIN
 *
 * Endpoints:
 *   GET  /execution/bridge-recon/status     — current reconciliation status
 *   GET  /execution/bridge-recon/mismatches — active mismatches
 *   POST /execution/bridge-recon/trigger    — manual reconciliation cycle
 */
@Controller('execution/bridge-recon')
export class BridgeReconController {
  constructor(
    private readonly reconService: CrossChainReconciliationService,
  ) {}

  /**
   * Get current reconciliation status.
   */
  @Get('status')
  getStatus() {
    const status = this.reconService.getStatus();
    return {
      lastCheckAt: status.lastCheckAt?.toISOString() ?? null,
      totalMismatches: status.totalMismatches,
      totalStale: status.totalStale,
      checkedPlans: status.checkedPlans,
      healthy: status.healthy,
    };
  }

  /**
   * Detect and return current bridge transfer mismatches.
   */
  @Get('mismatches')
  async getMismatches() {
    const mismatches = await this.reconService.detectBridgeMismatches();
    const staleTransfers = await this.reconService.detectStaleBridgeTransfers();

    // Generate incident descriptors for any found issues
    const incidents = [
      ...mismatches.map((m) =>
        this.reconService.generateBridgeIncident('mismatch', m),
      ),
      ...staleTransfers.map((s) =>
        this.reconService.generateBridgeIncident('stale', s),
      ),
    ];

    return {
      mismatches: mismatches.map((m) => ({
        transferId: m.transferId,
        legId: m.legId,
        planId: m.planId,
        bridgeKey: m.bridgeKey,
        sourceChainId: m.sourceChainId,
        destinationChainId: m.destinationChainId,
        mismatchType: m.mismatchType,
        details: m.details,
        detectedAt: m.detectedAt.toISOString(),
      })),
      staleTransfers: staleTransfers.map((s) => ({
        transferId: s.transferId,
        legId: s.legId,
        planId: s.planId,
        bridgeKey: s.bridgeKey,
        sourceChainId: s.sourceChainId,
        destinationChainId: s.destinationChainId,
        status: s.status,
        ageMs: s.ageMs,
        timeoutThresholdMs: s.timeoutThresholdMs,
        detectedAt: s.detectedAt.toISOString(),
      })),
      incidents,
    };
  }

  /**
   * Manually trigger a full reconciliation cycle.
   */
  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  async trigger() {
    const status = await this.reconService.runFullReconciliation();
    return {
      lastCheckAt: status.lastCheckAt!.toISOString(),
      totalMismatches: status.totalMismatches,
      totalStale: status.totalStale,
      checkedPlans: status.checkedPlans,
      healthy: status.healthy,
    };
  }
}