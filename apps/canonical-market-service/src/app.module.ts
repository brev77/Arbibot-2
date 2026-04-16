import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import { MarketModule } from './market/market.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [DatabaseModule, RedisModule, MarketModule],
})
export class AppModule {}
