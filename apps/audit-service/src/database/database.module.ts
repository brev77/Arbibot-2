import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import { AuditLogEntity } from '@arbibot/persistence';

@Module({
  imports: [typeOrmRootForEntities([AuditLogEntity])],
})
export class DatabaseModule {}
