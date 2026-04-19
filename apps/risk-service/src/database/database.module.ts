import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import {
  OutboxEventEntity,
  RiskDecisionEntity,
  RiskWindowReservationEntity,
  RouteProfileEntity,
  RouteScoringHistoryEntity,
  TokenProfileEntity,
  WatchlistTierSnapshotEntity,
} from '@arbibot/persistence';

@Module({
  imports: [
    typeOrmRootForEntities([
      RiskDecisionEntity,
      RiskWindowReservationEntity,
      OutboxEventEntity,
      TokenProfileEntity,
      RouteProfileEntity,
      WatchlistTierSnapshotEntity,
      RouteScoringHistoryEntity,
    ]),
  ],
})
export class DatabaseModule {}
