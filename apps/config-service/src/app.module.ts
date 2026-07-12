import { Module } from '@nestjs/common';

import { AuditClientModule, HealthModule } from '@arbibot/nest-platform';

import { DatabaseModule } from './database/database.module';
import { ConfigModule as PolicyConfigModule } from './config/config.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    HealthModule,
    AuditClientModule,
    DatabaseModule,
    RedisModule,
    PolicyConfigModule,
  ],
})
export class AppModule {}
