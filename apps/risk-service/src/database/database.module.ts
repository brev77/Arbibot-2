import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import { OutboxEventEntity, RiskDecisionEntity } from '@arbibot/persistence';

@Module({
  imports: [
    typeOrmRootForEntities([RiskDecisionEntity, OutboxEventEntity]),
  ],
})
export class DatabaseModule {}
