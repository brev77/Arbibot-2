/** Read model: `GET /positions` item (portfolio-service). */
export type PortfolioPositionListItem = {
  readonly id: string;
  readonly planId: string;
  /**
   * Canonical grouping key from execution settlement: plan `routeKey` if set at plan creation,
   * else `arb:risk-decision:{uuid}`, else `arb:execution-plan:{uuid}` (see `resolveInstrumentKeyForPlan` in execution-orchestrator).
   */
  readonly instrumentKey: string;
  readonly quantity: string;
  /**
   * Calculated notional value in USD (if available from venue data).
   * May be null for positions without pricing data.
   */
  readonly notionalUsd: string | null;
  readonly entityVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};
