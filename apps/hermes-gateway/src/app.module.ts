import { Module } from '@nestjs/common';

import { HealthModule } from './health/health.module';
import { HermesModule } from './hermes/hermes.module';

@Module({
  imports: [HealthModule, HermesModule],
})
export class AppModule {}
