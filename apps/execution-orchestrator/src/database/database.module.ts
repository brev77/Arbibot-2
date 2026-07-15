import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import {
  DexDailyVolumeEntity,
  ExecutionLegEntity,
  ExecutionLegFillIdempotencyEntity,
  ExecutionPlanEntity,
  OutboxEventEntity,
  OnChainTransaction,
  WalletState,
  WalletKeyEntity,
} from '@arbibot/persistence';

@Module({
  imports: [
    typeOrmRootForEntities([
      ExecutionPlanEntity,
      ExecutionLegEntity,
      ExecutionLegFillIdempotencyEntity,
      OutboxEventEntity,
      OnChainTransaction,
      WalletState,
      WalletKeyEntity,
      DexDailyVolumeEntity,
    ]),
  ],
})
export class DatabaseModule {}
