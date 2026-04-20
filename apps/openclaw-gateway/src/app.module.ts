import { Module } from '@nestjs/common';

import { HealthModule } from './health/health.module';
import { OpenclawModule } from './openclaw/openclaw.module';

@Module({
  imports: [HealthModule, OpenclawModule],
})
export class AppModule {}
