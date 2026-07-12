import { Module } from '@nestjs/common';

import { AuditClientModule, HealthModule } from '@arbibot/nest-platform';

import { DatabaseModule } from './database/database.module';
import { RiskModule } from './risk/risk.module';

@Module({
  imports: [HealthModule, AuditClientModule, DatabaseModule, RiskModule],
})
export class AppModule {}
