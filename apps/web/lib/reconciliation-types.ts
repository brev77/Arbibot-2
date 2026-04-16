/** Read model: `GET /mismatches` item (reconciliation-service). */
export type ReconciliationMismatchListItem = {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly details: Record<string, unknown> | null;
  readonly entityVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};
