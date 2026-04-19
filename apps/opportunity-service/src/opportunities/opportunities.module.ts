import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ArbitrageOpportunityEntity } from '@arbibot/persistence';

import { PaperDiscoveryService } from '../paper-discovery/paper-discovery.service';
import { PaperDiscoveryWorker } from '../paper-discovery/paper-discovery-worker';
import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { PaperClientService } from './paper-client.service';
import { RiskClientService } from './risk-client.service';

@Module({
  imports: [TypeOrmModule.forFeature([ArbitrageOpportunityEntity])],
  controllers: [OpportunitiesController],
  providers: [
    OpportunitiesService,
    RiskClientService,
    PaperClientService,
    PaperDiscoveryService,
    PaperDiscoveryWorker,
  ],
  exports: [PaperClientService, PaperDiscoveryService],
})
export class OpportunitiesModule {}
