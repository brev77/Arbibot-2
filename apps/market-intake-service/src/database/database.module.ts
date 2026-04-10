import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import {
  MarketSnapshotEntity,
  MarketSnapshotIngestIdempotencyEntity,
  OutboxEventEntity,
} from '@arbibot/persistence';

@Module({
  imports: [
    typeOrmRootForEntities([
      MarketSnapshotEntity,
      MarketSnapshotIngestIdempotencyEntity,
      OutboxEventEntity,
    ]),
  ],
})
export class DatabaseModule {}
