import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module';
import { SnapshotsModule } from './snapshots/snapshots.module';

@Module({
  imports: [DatabaseModule, SnapshotsModule],
})
export class AppModule {}
