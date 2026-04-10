import { Module } from '@nestjs/common';

import { AuditClientModule } from '@arbibot/nest-platform';

import { DatabaseModule } from './database/database.module';
import { PlansModule } from './plans/plans.module';

@Module({
  imports: [AuditClientModule, DatabaseModule, PlansModule],
})
export class AppModule {}
