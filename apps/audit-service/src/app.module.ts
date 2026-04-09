import { Module } from '@nestjs/common';

import { AuditModule } from './audit/audit.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [DatabaseModule, AuditModule],
})
export class AppModule {}
