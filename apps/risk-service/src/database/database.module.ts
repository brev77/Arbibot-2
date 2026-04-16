import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import {
  OutboxEventEntity,
  RiskDecisionEntity,
  RiskWindowReservationEntity,
  RouteProfileEntity,
  TokenProfileEntity,
} from '@arbibot/persistence';

@Module({
  imports: [
    typeOrmRootForEntities([
      RiskDecisionEntity,
      RiskWindowReservationEntity,
      OutboxEventEntity,
      TokenProfileEntity,
      RouteProfileEntity,
    ]),
  ],
})
export class DatabaseModule {}
