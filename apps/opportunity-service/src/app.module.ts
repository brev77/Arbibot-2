import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import { OpportunitiesModule } from './opportunities/opportunities.module';
import { OutboxRelayService } from './outbox-relay.service';

@Module({
  imports: [DatabaseModule, OpportunitiesModule],
  providers: [OutboxRelayService],
})
export class AppModule {}
