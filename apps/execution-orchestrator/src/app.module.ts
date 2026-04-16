import { Module } from '@nestjs/common';

import { AuditClientModule } from '@arbibot/nest-platform';

import { DatabaseModule } from './database/database.module';
import { LegsModule } from './legs/legs.module';
import { PlansModule } from './plans/plans.module';

@Module({
  imports: [AuditClientModule, DatabaseModule, PlansModule, LegsModule],
})
export class AppModule {}
