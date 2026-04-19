/** Read models: paper-trading-service Phase 3 HTTP JSON. */

export type PaperTradeListItem = {
  readonly id: string;
  readonly opportunityId: string | null;
  readonly instrumentKey: string;
  readonly routeKey: string | null;
  readonly state: string;
  readonly notional: string;
  readonly summary: Record<string, unknown>;
  readonly entityVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type PaperPromotionCandidateItem = {
  readonly id: string;
  readonly instrumentKey: string;
  readonly opportunityId: string | null;
  readonly source: string;
  readonly status: string;
  readonly score: string | null;
  readonly driftBps: string | null;
  readonly evidence: Record<string, unknown>;
  readonly enqueueIdempotencyKey: string | null;
  readonly entityVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type PaperDriftSampleItem = {
  readonly id: string;
  readonly instrumentKey: string;
  readonly paperMid: string;
  readonly referenceMid: string;
  readonly driftBps: string;
  readonly capturedAt: string;
};
