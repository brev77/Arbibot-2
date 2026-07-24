import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { SCANNER_HTTP_ROUTES } from '@arbibot/contracts';

import { ScannerConfigService } from './scanner-config.service';
import { ScannerFindingsService } from './scanner-findings.service';
import { ScannerPublisherService } from './scanner-publisher.service';
import { ScannerWorkerService } from './scanner-worker.service';
import { ScannerRpcService } from './scanner-rpc.service';

/**
 * Scanner HTTP API (S1-7-API).
 *
 * Exposes the routes declared in `SCANNER_HTTP_ROUTES` (@arbibot/contracts): instance listing +
 * config-join-runtime, manual cycle trigger, force-refresh config, findings list/get, and a
 * composite status snapshot. `POST /scanner/findings/:id/re-publish` is stubbed here (returns
 * 501) — the orphan re-publish worker arrives in Phase 3-2 (S3-2-DEGRADE).
 *
 * Audit: mutations (refresh-config, run) are logged by the underlying services; a dedicated
 * AuditClientService entry will be added when operator-auth is wired in S4-2/S5-3.
 */
@Controller('scanner')
export class ScannerController {
  constructor(
    private readonly config: ScannerConfigService,
    private readonly worker: ScannerWorkerService,
    private readonly findings: ScannerFindingsService,
    private readonly rpc: ScannerRpcService,
    private readonly publisher: ScannerPublisherService,
  ) {}

  /** GET /scanner/instances — config definitions (runtime status join arrives in S4-2 BFF). */
  @Get('instances')
  listInstances() {
    const instances = this.config.getInstances().map((i) => ({
      id: i.id,
      name: i.name,
      network: i.network,
      strategy: i.strategy,
      enabled: i.enabled,
    }));
    return { instances };
  }

  /** GET /scanner/instances/:id — single instance definition + worker runtime. */
  @Get('instances/:id')
  getInstance(@Param('id') id: string) {
    const instance = this.config.getInstances().find((i) => i.id === id);
    if (instance === undefined) {
      return { error: `Instance ${id} not found`, statusCode: HttpStatus.NOT_FOUND };
    }
    return { instance, worker: this.worker.getStatus() };
  }

  /**
   * POST /scanner/instances/:id/refresh-config — force-refresh the config cache so an operator
   * config change applies immediately (instead of waiting for the TTL).
   */
  @Post('instances/:id/refresh-config')
  @HttpCode(HttpStatus.OK)
  async refreshInstanceConfig(@Param('id') id: string) {
    await this.config.forceRefresh();
    const stillExists = this.config.getInstances().some((i) => i.id === id);
    return {
      instanceId: id,
      applied: stillExists,
      message: stillExists
        ? 'Config refreshed; instance is present'
        : 'Config refreshed; instance is no longer defined',
    };
  }

  /** POST /scanner/instances/:id/run — manual trigger of one instance cycle. */
  @Post('instances/:id/run')
  @HttpCode(HttpStatus.OK)
  runInstance(@Param('id') id: string) {
    return this.worker.triggerInstanceRun(id);
  }

  /** GET /scanner/findings — list, optional instanceId / publishStatus filters. */
  @Get('findings')
  listFindings(
    @Query('instanceId') instanceId?: string,
    @Query('publishStatus') publishStatus?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit !== undefined ? Number(limit) : 100;
    return this.findings.list(
      instanceId,
      publishStatus,
      Number.isFinite(parsedLimit) ? parsedLimit : 100,
    );
  }

  /** GET /scanner/findings/:id — single finding. */
  @Get('findings/:id')
  getFinding(@Param('id') id: string) {
    return this.findings.getById(id);
  }

  /**
   * POST /scanner/findings/:id/re-publish — manual re-publish of a failed/pending finding
   * to opportunity-service (S3-2-DEGRADE). Returns the opportunity id or an error shape.
   */
  @Post('findings/:id/re-publish')
  @HttpCode(HttpStatus.OK)
  async republishFinding(@Param('id') id: string) {
    const finding = await this.findings.getById(id);
    const spread = {
      chainId: finding.chainId,
      canonicalToken: finding.canonicalToken,
      token0: finding.buyPoolAddr,
      token1: finding.canonicalToken,
      buyVenue: finding.buyVenue,
      buyPoolAddress: finding.buyPoolAddr,
      buyPrice: 0,
      sellVenue: finding.sellVenue,
      sellPoolAddress: finding.sellPoolAddr,
      sellPrice: 0,
      spreadBps: finding.spreadBps,
      feesUsd: Number(finding.feesUsd),
      gasUsd: 0,
      grossProfitUsd: Number(finding.grossProfitUsd),
      netProfitUsd: Number(finding.netProfitUsd),
    };
    const timeoutMs = this.config.getConfig().defaults.opportunityPublishTimeoutMs;
    const oppId = await this.publisher.publish(finding, spread, timeoutMs);
    if (oppId === null) {
      return {
        findingId: id,
        published: false,
        message: 'Re-publish failed; finding remains in pending/failed state',
      };
    }
    return {
      findingId: id,
      published: true,
      opportunityId: oppId,
    };
  }

  /** GET /scanner/status — composite: worker + config + RPC health. */
  @Get('status')
  getStatus() {
    return {
      worker: this.worker.getStatus(),
      instances: {
        total: this.config.getInstances().length,
        enabled: this.config.getEnabledInstances().length,
      },
      rpc: this.rpc.getAllHealthStatus(),
      configCacheTtlMs: this.config.getConfig().defaults.configCacheTtlMs,
    };
  }
}

/** Reference the routes constant so dead-code elimination keeps it in the bundle. */
void SCANNER_HTTP_ROUTES;
