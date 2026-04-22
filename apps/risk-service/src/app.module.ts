import { Module } from '@nestjs/common';

import { AuditClientModule } from '@arbibot/nest-platform';

import { DatabaseModule } from './database/database.module';
import { RiskModule } from './risk/risk.module';

@Module({
  imports: [AuditClientModule, DatabaseModule, RiskModule],
})
export class AppModule {}
