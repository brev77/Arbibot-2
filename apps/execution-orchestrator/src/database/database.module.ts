import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import {
  ExecutionLegEntity,
  ExecutionLegFillIdempotencyEntity,
  ExecutionPlanEntity,
  OutboxEventEntity,
} from '@arbibot/persistence';

@Module({
  imports: [
    typeOrmRootForEntities([
      ExecutionPlanEntity,
      ExecutionLegEntity,
      ExecutionLegFillIdempotencyEntity,
      OutboxEventEntity,
    ]),
  ],
})
export class DatabaseModule {}
