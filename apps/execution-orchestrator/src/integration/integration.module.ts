import { Module } from '@nestjs/common';

import { CapitalHttpClient } from './capital-http.client';
import { RiskHttpClient } from './risk-http.client';

@Module({
  providers: [CapitalHttpClient, RiskHttpClient],
  exports: [CapitalHttpClient, RiskHttpClient],
})
export class IntegrationModule {}
