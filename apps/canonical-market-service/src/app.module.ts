import { Module } from '@nestjs/common';

import { HealthModule } from '@arbibot/nest-platform';

import { DatabaseModule } from './database/database.module';
import { MarketModule } from './market/market.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [HealthModule, DatabaseModule, RedisModule, MarketModule],
})
export class AppModule {}
