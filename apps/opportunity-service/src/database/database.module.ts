import { Module } from '@nestjs/common';

import { typeOrmRootForEntities } from '@arbibot/nest-database';
import { ArbitrageOpportunityEntity } from '@arbibot/persistence';

@Module({
  imports: [typeOrmRootForEntities([ArbitrageOpportunityEntity])],
})
export class DatabaseModule {}
