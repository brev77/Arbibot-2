/** Read model: `GET /opportunities` item (Phase 1). */
export type OpportunityListItem = {
  readonly id: string;
  readonly state: string;
  readonly correlationId: string | null;
  readonly riskDecisionId: string | null;
  readonly entityVersion: number;
  readonly createdAt: string;
};

/** Read model: `GET /opportunities/:id` (Phase 1). */
export type OpportunityDetail = OpportunityListItem & {
  readonly payload: Record<string, unknown>;
  readonly updatedAt: string;
};
