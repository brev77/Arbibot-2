import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import {
  ArbitrageOpportunityEntity,
  InboxEventEntity,
  OutboxEventEntity,
} from '@arbibot/persistence';

@Module({
  imports: [
    typeOrmRootForEntities([
      ArbitrageOpportunityEntity,
      InboxEventEntity,
      OutboxEventEntity,
    ]),
  ],
})
export class DatabaseModule {}
