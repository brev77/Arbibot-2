import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import { MarketModule } from './market/market.module';

@Module({
  imports: [DatabaseModule, MarketModule],
})
export class AppModule {}
