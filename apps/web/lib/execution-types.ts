/** Read model: `GET /execution/plans` item (execution-orchestrator). */
export type ExecutionPlanListItem = {
  readonly id: string;
  readonly state: string;
  readonly correlationId: string | null;
  readonly capitalReservationId: string | null;
  readonly riskDecisionId: string | null;
  readonly entityVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};
