import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import { CapitalReservationEntity, OutboxEventEntity } from '@arbibot/persistence';

@Module({
  imports: [typeOrmRootForEntities([CapitalReservationEntity, OutboxEventEntity])],
})
export class DatabaseModule {}
