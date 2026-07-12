import { Module } from '@nestjs/common';

import { AuditClientModule, HealthModule } from '@arbibot/nest-platform';

import { DatabaseModule } from './database/database.module';
import { ExecutionModule } from './execution/execution.module';
import { LegsModule } from './legs/legs.module';
import { PlansModule } from './plans/plans.module';

@Module({
  imports: [
    HealthModule,
    AuditClientModule,
    DatabaseModule,
    ExecutionModule,
    PlansModule,
    LegsModule,
  ],
})
export class AppModule {}
