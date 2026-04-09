import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import { RiskModule } from './risk/risk.module';

@Module({
  imports: [DatabaseModule, RiskModule],
})
export class AppModule {}
