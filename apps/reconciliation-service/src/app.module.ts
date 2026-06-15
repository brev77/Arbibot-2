import { Module } from '@nestjs/common';

import { AlertsModule } from './alerts/alerts.module';
import { DatabaseModule } from './database/database.module';
import { MismatchesModule } from './mismatches/mismatches.module';

@Module({
  imports: [DatabaseModule, MismatchesModule, AlertsModule],
})
export class AppModule {}
