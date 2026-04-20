import { Injectable } from '@nestjs/common';

import { getReconciliationApiBase } from './openclaw-env';
import { OpenclawUpstreamService } from './openclaw-upstream.service';

export type IncidentBriefItem = {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly summary: string;
  readonly updatedAt: string;
};

@Injectable()
export class IncidentBriefsService {
  constructor(private readonly upstream: OpenclawUpstreamService) {}

  /**
   * Short operator-facing summaries from reconciliation mismatches (read-only aggregate).
   */
  async buildBriefs(correlationId?: string): Promise<{ items: IncidentBriefItem[] }> {
    const base = getReconciliationApiBase();
    const result = await this.upstream.getJson(
      `${base}/mismatches`,
      correlationId,
    );
    if (result.status >= 400) {
      return { items: [] };
    }
    const body = result.json as { items?: unknown };
    const raw = Array.isArray(body.items) ? body.items : [];
    const items: IncidentBriefItem[] = raw.map((row) => {
      const r = row as Record<string, unknown>;
      const id = typeof r.id === 'string' ? r.id : '';
      const kind = typeof r.kind === 'string' ? r.kind : 'unknown';
      const status = typeof r.status === 'string' ? r.status : 'open';
      const details = r.details;
      let summary = `${kind} — ${status}`;
      if (typeof details === 'object' && details !== null && 'hint' in details) {
        const h = (details as { hint?: unknown }).hint;
        if (typeof h === 'string' && h.length > 0) {
          summary = h;
        }
      }
      const updatedAt =
        typeof r.updatedAt === 'string'
          ? r.updatedAt
          : new Date().toISOString();
      return { id, kind, status, summary, updatedAt };
    });
    return { items };
  }
}
