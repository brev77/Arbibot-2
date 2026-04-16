import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import { PositionsModule } from './positions/positions.module';

@Module({
  imports: [DatabaseModule, PositionsModule],
})
export class AppModule {}
