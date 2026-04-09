import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import { CapitalReservationEntity } from '@arbibot/persistence';

@Module({
  imports: [typeOrmRootForEntities([CapitalReservationEntity])],
})
export class DatabaseModule {}
