import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { signedFetch } from '@arbibot/nest-platform';
import {
  OPPORTUNITY_SOURCE_SCANNER,
  type OpportunityDetectedPayloadV1,
} from '@arbibot/contracts';
import { ScannerFindingEntity } from '@arbibot/persistence';
import { randomUUID } from 'node:crypto';

import type { CrossVenueSpread } from './scanner-spread.service';

/**
 * Opportunity publisher (S3-1-PUBLISH).
 *
 * Publishes a scanner finding to opportunity-service via `POST /opportunities`, saving the
 * returned `opportunityId` back onto the finding row and flipping `publish_status` to
 * `published`. On failure, increments `publish_attempts` and marks the finding `failed` (the
 * Phase 3-2 orphan worker retries it later).
 *
 * The POST body shape is `{ correlationId?, payload? }` — opportunity-service stores the whole
 * finding as an opaque JSONB `payload` (see opportunity-service CreateOpportunityDto). All scanner
 * fields are nested inside `payload`, mirroring `OpportunityDetectedPayloadV1` (contracts/events.ts).
 *
 * Outbound HTTP uses `signedFetch` (header `x-arbibot-signature`) so service-auth (HMAC) is applied
 * when `ARBIBOT_SERVICE_AUTH_ENABLED=true`. Base URL from `OPPORTUNITY_SERVICE_URL` (default 3010).
 */
@Injectable()
export class ScannerPublisherService {
  private readonly logger = new Logger(ScannerPublisherService.name);

  constructor(
    @InjectRepository(ScannerFindingEntity)
    private readonly findingsRepo: Repository<ScannerFindingEntity>,
  ) {}

  /**
   * Publish a finding to opportunity-service. Updates the finding row regardless of outcome
   * (published on success, failed on error). Returns the opportunity id or null on failure.
   */
  async publish(
    finding: ScannerFindingEntity,
    spread: CrossVenueSpread,
    timeoutMs: number,
  ): Promise<string | null> {
    const payload = this.buildPayload(finding, spread);
    const correlationId = randomUUID();
    const body = JSON.stringify({ correlationId, payload });

    const base = this.buildBaseUrl();
    if (base === null) {
      this.logger.warn('OPPORTUNITY_SERVICE_URL not set; marking finding as failed');
      await this.markFailed(finding, 'OPPORTUNITY_SERVICE_URL not configured');
      return null;
    }

    try {
      const response = await signedFetch(`${base}/opportunities`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-correlation-id': correlationId,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        await this.markFailed(
          finding,
          `opportunity-service HTTP ${response.status}: ${text.slice(0, 200)}`,
        );
        return null;
      }

      const result = (await response.json()) as { id?: string };
      if (typeof result.id !== 'string' || result.id.length === 0) {
        await this.markFailed(finding, 'opportunity-service response missing id');
        return null;
      }

      await this.markPublished(finding, result.id);
      return result.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.markFailed(finding, msg);
      return null;
    }
  }

  /** Re-publish an existing finding by its id (manual re-publish / orphan worker). */
  async republishById(
    findingId: string,
    spread: CrossVenueSpread,
    timeoutMs: number,
  ): Promise<string | null> {
    const finding = await this.findingsRepo.findOne({ where: { id: findingId } });
    if (finding === null) {
      this.logger.warn(`Cannot re-publish: finding ${findingId} not found`);
      return null;
    }
    return this.publish(finding, spread, timeoutMs);
  }

  // --- internal ------------------------------------------------------------

  private buildPayload(
    finding: ScannerFindingEntity,
    spread: CrossVenueSpread,
  ): OpportunityDetectedPayloadV1 {
    return {
      opportunityId: finding.id,
      instrumentKey: this.deriveInstrumentKey(spread),
      routeKey: null,
      sourceModule: OPPORTUNITY_SOURCE_SCANNER,
      spreadBps: spread.spreadBps,
      grossProfitUsd: spread.grossProfitUsd,
      netProfitUsd: spread.netProfitUsd,
      feesUsd: spread.feesUsd,
      volumeUsd: finding.volume1hUsd !== null ? Number(finding.volume1hUsd) : null,
      buyVenue: spread.buyVenue,
      sellVenue: spread.sellVenue,
      chainId: spread.chainId,
      token: spread.canonicalToken,
      quoteAsset: spread.token1,
      evidence: {
        buyPoolAddress: spread.buyPoolAddress,
        sellPoolAddress: spread.sellPoolAddress,
        buyPrice: spread.buyPrice,
        sellPrice: spread.sellPrice,
        gasUsd: spread.gasUsd,
      },
    };
  }

  private deriveInstrumentKey(spread: CrossVenueSpread): string {
    // Canonical instrument key: arb:{chainId}:{token0-token1}. Resolved properly via
    // canonical-market-service in production; this is a stable local derivation.
    return `arb:${spread.chainId}:${spread.token0}-${spread.token1}`;
  }

  private buildBaseUrl(): string | null {
    const raw = process.env.OPPORTUNITY_SERVICE_URL?.trim() ?? '';
    if (raw.length === 0) {
      return null;
    }
    return raw.replace(/\/$/, '');
  }

  private async markPublished(finding: ScannerFindingEntity, opportunityId: string): Promise<void> {
    finding.opportunityId = opportunityId;
    finding.publishStatus = 'published';
    finding.publishAttempts += 1;
    await this.findingsRepo.save(finding);
  }

  private async markFailed(finding: ScannerFindingEntity, error: string): Promise<void> {
    finding.publishStatus = 'failed';
    finding.publishAttempts += 1;
    this.logger.warn(`Finding ${finding.id} publish failed (attempt ${finding.publishAttempts}): ${error}`);
    await this.findingsRepo.save(finding);
  }
}
