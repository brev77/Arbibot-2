export { ArbitrageOpportunityEntity } from './arbitrage-opportunity.entity';
export { AuditLogEntity } from './audit-log.entity';
export { CapitalReservationEntity } from './capital-reservation.entity';
export { materializeCapitalReservationExpiryIfNeeded } from './capital-reservation-expiry';
export { ExecutionLegEntity } from './execution-leg.entity';
export { ExecutionPlanEntity } from './execution-plan.entity';
export { InboxEventEntity } from './inbox-event.entity';
export { OutboxEventEntity } from './outbox-event.entity';
export { RiskDecisionEntity } from './risk-decision.entity';
export { RiskWindowReservationEntity } from './risk-window-reservation.entity';
export { materializeRiskWindowReservationExpiryIfNeeded } from './risk-window-reservation-expiry';

import { ArbitrageOpportunityEntity } from './arbitrage-opportunity.entity';
import { AuditLogEntity } from './audit-log.entity';
import { CapitalReservationEntity } from './capital-reservation.entity';
import { ExecutionLegEntity } from './execution-leg.entity';
import { ExecutionPlanEntity } from './execution-plan.entity';
import { InboxEventEntity } from './inbox-event.entity';
import { OutboxEventEntity } from './outbox-event.entity';
import { RiskDecisionEntity } from './risk-decision.entity';
import { RiskWindowReservationEntity } from './risk-window-reservation.entity';

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
] as const;
