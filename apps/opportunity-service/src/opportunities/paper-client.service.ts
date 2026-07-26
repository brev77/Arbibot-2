import { Injectable, Logger } from '@nestjs/common';

import { signedFetch } from '@arbibot/nest-platform';

export type PaperPromotionEnqueueBody = {
  readonly instrumentKey: string;
  readonly opportunityId: string;
  readonly source?: string;
  readonly score?: number;
  readonly driftBps?: number;
  readonly evidence?: Record<string, unknown>;
  /** Stable idempotency key; must match outbox payload for relay retries. */
  readonly enqueueIdempotencyKey: string;
  /** Net opportunity profit in USD — copied through for paper settle (additive v1.1). */
  readonly netProfitUsd?: number;
  /** Cross-venue spread in basis points — copied through for paper settle. */
  readonly spreadBps?: number;
  /** Buy venue key — copied through for paper settle. */
  readonly buyVenue?: string;
  /** Sell venue key — copied through for paper settle. */
  readonly sellVenue?: string;
};

@Injectable()
export class PaperClientService {
  private readonly log = new Logger(PaperClientService.name);

  private baseUrl(): string | null {
    const raw = process.env.PAPER_TRADING_SERVICE_URL?.trim();
    if (raw === undefined || raw.length === 0) {
      return null;
    }
    return raw.replace(/\/$/, '');
  }

  isEnabled(): boolean {
    return this.baseUrl() !== null;
  }

  async enqueuePromotionCandidate(body: PaperPromotionEnqueueBody): Promise<boolean> {
    const base = this.baseUrl();
    if (base === null) {
      return false;
    }
    const url = `${base}/paper/promotion-candidates`;
    const res = await signedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        instrumentKey: body.instrumentKey,
        opportunityId: body.opportunityId,
        source: body.source ?? 'opportunity_hook',
        score: body.score,
        driftBps: body.driftBps,
        evidence: body.evidence ?? {},
        enqueueIdempotencyKey: body.enqueueIdempotencyKey,
        // Additive v1.1 P/L fields — paper-trading-service persists them onto the candidate.
        ...(body.netProfitUsd !== undefined ? { netProfitUsd: body.netProfitUsd } : {}),
        ...(body.spreadBps !== undefined ? { spreadBps: body.spreadBps } : {}),
        ...(body.buyVenue !== undefined ? { buyVenue: body.buyVenue } : {}),
        ...(body.sellVenue !== undefined ? { sellVenue: body.sellVenue } : {}),
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      this.log.warn(
        `Paper promotion enqueue failed: ${res.status} ${text.slice(0, 200)}`,
      );
      return false;
    }
    return true;
  }
}
