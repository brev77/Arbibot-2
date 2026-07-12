import { Module } from '@nestjs/common';

import { HealthModule } from '@arbibot/nest-platform';

import { AlertsModule } from './alerts/alerts.module';
import { DatabaseModule } from './database/database.module';
import { MismatchesModule } from './mismatches/mismatches.module';

@Module({
  imports: [HealthModule, DatabaseModule, MismatchesModule, AlertsModule],
})
export class AppModule {}
