import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import {
  CapitalReservationEntity,
  ExecutionLegEntity,
  ExecutionPlanEntity,
  RiskDecisionEntity,
} from '@arbibot/persistence';

@Module({
  imports: [
    typeOrmRootForEntities([
      ExecutionPlanEntity,
      ExecutionLegEntity,
      CapitalReservationEntity,
      RiskDecisionEntity,
    ]),
  ],
})
export class DatabaseModule {}
