import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import { PlansModule } from './plans/plans.module';

@Module({
  imports: [DatabaseModule, PlansModule],
})
export class AppModule {}
