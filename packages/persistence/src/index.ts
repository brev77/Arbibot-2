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
export { PaperCapitalReservationEntity } from './paper-capital-reservation.entity';
export type { PaperCapitalReservationState } from './paper-capital-reservation.entity';
export { PaperDriftSampleEntity } from './paper-drift-sample.entity';
export { PaperDiscoveryCandidateEntity } from './paper-discovery-candidate.entity';
export type { PaperDiscoveryCandidateStatus } from './paper-discovery-candidate.entity';
export {
  PaperPromotionCandidateEntity,
  PAPER_PROMOTION_STATUSES,
} from './paper-promotion-candidate.entity';
export type { PaperPromotionStatus } from './paper-promotion-candidate.entity';
export { PaperTradeEntity, PAPER_TRADE_STATES } from './paper-trade.entity';
export type { PaperTradeState } from './paper-trade.entity';
export { PolicyConfigurationEntity } from './policy-configuration.entity';
export { PortfolioPositionEntity } from './portfolio-position.entity';
export { PortfolioPositionFillIdempotencyEntity } from './portfolio-position-fill-idempotency.entity';
export { PortfolioPositionCloseIdempotencyEntity } from './portfolio-position-close-idempotency.entity';
export { ReconciliationMismatchEntity } from './reconciliation-mismatch.entity';
export { RouteProfileEntity } from './route-profile.entity';
export { RouteScoringHistoryEntity } from './route-scoring-history.entity';
export { RiskDecisionEntity } from './risk-decision.entity';
export { RiskWindowReservationEntity } from './risk-window-reservation.entity';
export { materializeRiskWindowReservationExpiryIfNeeded } from './risk-window-reservation-expiry';
export { TokenProfileEntity } from './token-profile.entity';
export { VenueRefEntity } from './venue-ref.entity';
export { WatchlistTierSnapshotEntity } from './watchlist-tier-snapshot.entity';
export { BridgeTransferEntity } from './bridge-transfer.entity';
export { OnChainTransaction } from './on-chain-transaction.entity';
export { WalletState } from './wallet-state.entity';
export { DexPool } from './dex-pool.entity';
export { Approval } from './approval.entity';

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
import { PaperCapitalReservationEntity } from './paper-capital-reservation.entity';
import { PaperDriftSampleEntity } from './paper-drift-sample.entity';
import { PaperDiscoveryCandidateEntity } from './paper-discovery-candidate.entity';
import { PaperPromotionCandidateEntity } from './paper-promotion-candidate.entity';
import { PaperTradeEntity } from './paper-trade.entity';
import { PolicyConfigurationEntity } from './policy-configuration.entity';
import { PortfolioPositionCloseIdempotencyEntity } from './portfolio-position-close-idempotency.entity';
import { PortfolioPositionFillIdempotencyEntity } from './portfolio-position-fill-idempotency.entity';
import { PortfolioPositionEntity } from './portfolio-position.entity';
import { ReconciliationMismatchEntity } from './reconciliation-mismatch.entity';
import { RouteProfileEntity } from './route-profile.entity';
import { RouteScoringHistoryEntity } from './route-scoring-history.entity';
import { RiskDecisionEntity } from './risk-decision.entity';
import { RiskWindowReservationEntity } from './risk-window-reservation.entity';
import { TokenProfileEntity } from './token-profile.entity';
import { VenueRefEntity } from './venue-ref.entity';
import { WatchlistTierSnapshotEntity } from './watchlist-tier-snapshot.entity';
import { BridgeTransferEntity } from './bridge-transfer.entity';
import { OnChainTransaction } from './on-chain-transaction.entity';
import { WalletState } from './wallet-state.entity';
import { DexPool } from './dex-pool.entity';
import { Approval } from './approval.entity';

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
  PolicyConfigurationEntity,
  PortfolioPositionEntity,
  PortfolioPositionFillIdempotencyEntity,
  PortfolioPositionCloseIdempotencyEntity,
  ReconciliationMismatchEntity,
  TokenProfileEntity,
  RouteProfileEntity,
  WatchlistTierSnapshotEntity,
  RouteScoringHistoryEntity,
  PaperTradeEntity,
  PaperPromotionCandidateEntity,
  PaperDriftSampleEntity,
  PaperCapitalReservationEntity,
  PaperDiscoveryCandidateEntity,
  BridgeTransferEntity,
  OnChainTransaction,
  WalletState,
  DexPool,
  Approval,
] as const;
