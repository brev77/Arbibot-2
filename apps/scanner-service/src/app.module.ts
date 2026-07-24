import { Module } from '@nestjs/common';

import { HealthModule } from '@arbibot/nest-platform';

import { DatabaseModule } from './database/database.module';
import { HealthModule as LocalHealthModule } from './health/health.module';
import { ScannerModule } from './scanner/scanner.module';

@Module({
  imports: [HealthModule, DatabaseModule, ScannerModule, LocalHealthModule],
})
export class AppModule {}
