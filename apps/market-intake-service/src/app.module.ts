import { Module } from '@nestjs/common';

import { HealthModule } from '@arbibot/nest-platform';

import { DatabaseModule } from './database/database.module';
import { HealthModule as LocalHealthModule } from './health/health.module';
import { PolicyModule } from './policy/policy.module';
import { SnapshotsModule } from './snapshots/snapshots.module';

@Module({
  imports: [
    HealthModule,
    DatabaseModule,
    PolicyModule,
    LocalHealthModule,
    SnapshotsModule,
  ],
})
export class AppModule {}
