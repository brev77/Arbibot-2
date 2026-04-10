import { Module } from '@nestjs/common';

import { AuditClientModule } from '@arbibot/nest-platform';

import { CapitalModule } from './capital/capital.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [AuditClientModule, DatabaseModule, CapitalModule],
})
export class AppModule {}
