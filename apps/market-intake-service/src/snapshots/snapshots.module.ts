import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketSnapshotEntity } from '@arbibot/persistence';
import { AuditClientModule } from '@arbibot/nest-platform';

import { SnapshotsController } from './snapshots.controller';
import { SnapshotsService } from './snapshots.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MarketSnapshotEntity]),
    AuditClientModule,
  ],
  controllers: [SnapshotsController],
  providers: [SnapshotsService],
})
export class SnapshotsModule {}
