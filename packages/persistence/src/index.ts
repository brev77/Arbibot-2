export { ArbitrageOpportunityEntity } from './arbitrage-opportunity.entity';
export { AuditLogEntity } from './audit-log.entity';
export { CanonicalInstrumentEntity } from './canonical-instrument.entity';
export { CanonicalRouteEntity } from './canonical-route.entity';
export { CapitalReservationEntity } from './capital-reservation.entity';
export { materializeCapitalReservationExpiryIfNeeded } from './capital-reservation-expiry';
export { ExecutionLegEntity } from './execution-leg.entity';
export { ExecutionLegFillIdempotencyEntity } from './execution-leg-fill-idempotency.entity';
export { ExecutionPlanEntity } from './execution-plan.entity';
export { InboxEventEntity } from './inbox-event.entity';
export { MarketSnapshotEntity } from './market-snapshot.entity';
export { MarketSnapshotIngestIdempotencyEntity } from './market-snapshot-ingest-idempotency.entity';
export { OutboxEventEntity } from './outbox-event.entity';
export { PortfolioPositionEntity } from './portfolio-position.entity';
export { PortfolioPositionFillIdempotencyEntity } from './portfolio-position-fill-idempotency.entity';
export { ReconciliationMismatchEntity } from './reconciliation-mismatch.entity';
export { RiskDecisionEntity } from './risk-decision.entity';
export { RiskWindowReservationEntity } from './risk-window-reservation.entity';
export { materializeRiskWindowReservationExpiryIfNeeded } from './risk-window-reservation-expiry';
export { VenueRefEntity } from './venue-ref.entity';

import { ArbitrageOpportunityEntity } from './arbitrage-opportunity.entity';
import { AuditLogEntity } from './audit-log.entity';
import { CanonicalInstrumentEntity } from './canonical-instrument.entity';
import { CanonicalRouteEntity } from './canonical-route.entity';
import { CapitalReservationEntity } from './capital-reservation.entity';
import { ExecutionLegFillIdempotencyEntity } from './execution-leg-fill-idempotency.entity';
import { ExecutionLegEntity } from './execution-leg.entity';
import { ExecutionPlanEntity } from './execution-plan.entity';
import { InboxEventEntity } from './inbox-event.entity';
import { MarketSnapshotEntity } from './market-snapshot.entity';
import { MarketSnapshotIngestIdempotencyEntity } from './market-snapshot-ingest-idempotency.entity';
import { OutboxEventEntity } from './outbox-event.entity';
import { PortfolioPositionFillIdempotencyEntity } from './portfolio-position-fill-idempotency.entity';
import { PortfolioPositionEntity } from './portfolio-position.entity';
import { ReconciliationMismatchEntity } from './reconciliation-mismatch.entity';
import { RiskDecisionEntity } from './risk-decision.entity';
import { RiskWindowReservationEntity } from './risk-window-reservation.entity';
import { VenueRefEntity } from './venue-ref.entity';

/** All entities for TypeORM `entities` array. */
export const ARBIBOT_TYPEORM_ENTITIES = [
  RiskDecisionEntity,
  RiskWindowReservationEntity,
  OutboxEventEntity,
  InboxEventEntity,
  AuditLogEntity,
  ArbitrageOpportunityEntity,
  CapitalReservationEntity,
  ExecutionPlanEntity,
  ExecutionLegEntity,
  ExecutionLegFillIdempotencyEntity,
  VenueRefEntity,
  CanonicalInstrumentEntity,
  CanonicalRouteEntity,
  MarketSnapshotEntity,
  MarketSnapshotIngestIdempotencyEntity,
  PortfolioPositionEntity,
  PortfolioPositionFillIdempotencyEntity,
  ReconciliationMismatchEntity,
] as const;
