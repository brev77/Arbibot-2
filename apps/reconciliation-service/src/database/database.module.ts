import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import { ReconciliationMismatchEntity } from '@arbibot/persistence';

@Module({
  imports: [typeOrmRootForEntities([ReconciliationMismatchEntity])],
})
export class DatabaseModule {}
