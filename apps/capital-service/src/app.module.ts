import { Module } from '@nestjs/common';

import { CapitalModule } from './capital/capital.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [DatabaseModule, CapitalModule],
})
export class AppModule {}
