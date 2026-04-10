import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import {
  OutboxEventEntity,
  RiskDecisionEntity,
  RiskWindowReservationEntity,
} from '@arbibot/persistence';

@Module({
  imports: [
    typeOrmRootForEntities([
      RiskDecisionEntity,
      RiskWindowReservationEntity,
      OutboxEventEntity,
    ]),
  ],
})
export class DatabaseModule {}
