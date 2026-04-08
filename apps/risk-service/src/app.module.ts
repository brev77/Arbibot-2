import { Module } from '@nestjs/common';

import { RiskModule } from './risk/risk.module';

@Module({
  imports: [RiskModule],
})
export class AppModule {}
