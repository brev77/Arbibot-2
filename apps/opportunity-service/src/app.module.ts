import { Module } from '@nestjs/common';

import { HealthModule } from '@arbibot/nest-platform';

import { DatabaseModule } from './database/database.module';
import { OpportunitiesModule } from './opportunities/opportunities.module';
import { OutboxRelayService } from './outbox-relay.service';

@Module({
  imports: [HealthModule, DatabaseModule, OpportunitiesModule],
  providers: [OutboxRelayService],
})
export class AppModule {}
