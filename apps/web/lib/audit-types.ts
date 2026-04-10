/** Read model: `GET /audit/entries` item (Phase 1). */
export type AuditListItem = {
  readonly id: string;
  readonly correlationId: string | null;
  readonly actor: string;
  readonly action: string;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly payload: Record<string, unknown> | null;
  readonly createdAt: string;
};
