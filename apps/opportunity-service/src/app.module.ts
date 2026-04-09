import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import { OpportunitiesModule } from './opportunities/opportunities.module';

@Module({
  imports: [DatabaseModule, OpportunitiesModule],
})
export class AppModule {}
