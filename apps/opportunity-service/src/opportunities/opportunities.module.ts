import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ArbitrageOpportunityEntity } from '@arbibot/persistence';

import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { RiskClientService } from './risk-client.service';

@Module({
  imports: [TypeOrmModule.forFeature([ArbitrageOpportunityEntity])],
  controllers: [OpportunitiesController],
  providers: [OpportunitiesService, RiskClientService],
})
export class OpportunitiesModule {}
