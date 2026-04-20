import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { PolicyModule } from './policy/policy.module';
import { SnapshotsModule } from './snapshots/snapshots.module';

@Module({
  imports: [DatabaseModule, PolicyModule, HealthModule, SnapshotsModule],
})
export class AppModule {}
