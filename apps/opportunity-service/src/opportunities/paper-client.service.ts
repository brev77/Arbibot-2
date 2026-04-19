import { Injectable, Logger } from '@nestjs/common';

export type PaperPromotionEnqueueBody = {
  readonly instrumentKey: string;
  readonly opportunityId: string;
  readonly source?: string;
  readonly score?: number;
  readonly driftBps?: number;
  readonly evidence?: Record<string, unknown>;
  /** Stable idempotency key; must match outbox payload for relay retries. */
  readonly enqueueIdempotencyKey: string;
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
    const res = await fetch(url, {
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
