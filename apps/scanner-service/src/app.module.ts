import { Module } from '@nestjs/common';

import { HealthModule } from '@arbibot/nest-platform';

import { DatabaseModule } from './database/database.module';
import { ScannerModule } from './scanner/scanner.module';

@Module({
  imports: [HealthModule, DatabaseModule, ScannerModule],
})
export class AppModule {}
