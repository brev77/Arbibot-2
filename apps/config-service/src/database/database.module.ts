import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import { OutboxEventEntity, PolicyConfigurationEntity } from '@arbibot/persistence';

@Module({
  imports: [
    typeOrmRootForEntities([PolicyConfigurationEntity, OutboxEventEntity]),
  ],
})
export class DatabaseModule {}
