import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import {
  AlertmanagerIncidentEntity,
  ReconciliationMismatchEntity,
} from '@arbibot/persistence';

@Module({
  imports: [
    typeOrmRootForEntities([ReconciliationMismatchEntity, AlertmanagerIncidentEntity]),
  ],
})
export class DatabaseModule {}
