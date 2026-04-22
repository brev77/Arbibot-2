import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  OutboxEventEntity,
  RiskDecisionEntity,
  RiskWindowReservationEntity,
  RouteProfileEntity,
  RouteScoringHistoryEntity,
  TokenProfileEntity,
  WatchlistTierSnapshotEntity,
} from '@arbibot/persistence';

/**
 * Single TypeOrmModule.forFeature for all risk-service entities.
 * Splitting forFeature across nested modules breaks DataSource injection
 * with @nestjs/typeorm 11 + typeorm 0.3 (TokenProfileEntityRepository).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TokenProfileEntity,
      RouteProfileEntity,
      WatchlistTierSnapshotEntity,
      RouteScoringHistoryEntity,
      RiskDecisionEntity,
      RiskWindowReservationEntity,
      OutboxEventEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class RiskEntitiesModule {}
