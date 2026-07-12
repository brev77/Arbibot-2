import { Module } from '@nestjs/common';

import { HealthModule } from '@arbibot/nest-platform';

import { AuditModule } from './audit/audit.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [HealthModule, DatabaseModule, AuditModule],
})
export class AppModule {}
