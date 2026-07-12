import { Module } from '@nestjs/common';

import { HealthModule } from '@arbibot/nest-platform';

import { DatabaseModule } from './database/database.module';
import { PositionsModule } from './positions/positions.module';

@Module({
  imports: [HealthModule, DatabaseModule, PositionsModule],
})
export class AppModule {}
