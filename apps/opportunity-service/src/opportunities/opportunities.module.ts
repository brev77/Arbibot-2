import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ArbitrageOpportunityEntity } from '@arbibot/persistence';

import { PaperDiscoveryService } from '../paper-discovery/paper-discovery.service';
import { PaperDiscoveryWorker } from '../paper-discovery/paper-discovery-worker';
import { AutoDriveWorker } from './auto-drive.worker';
import { LiveAutoDriveConfigService } from './live-auto-drive-config.service';
import { LiveAutoDriveWorker } from './live-auto-drive.worker';
import { LiveKillSwitchService } from './live-kill-switch.service';
import { LivePriceClientService } from './live-price-client.service';
import { OpportunitiesController } from './opportunities.controller';
import { OpportunitiesService } from './opportunities.service';
import { PaperClientService } from './paper-client.service';
import { PlanSetupOrchestrator } from './plan-setup-orchestrator.service';
import { RiskClientService } from './risk-client.service';
import { TokenResolverService } from './token-resolver.service';

@Module({
  imports: [TypeOrmModule.forFeature([ArbitrageOpportunityEntity])],
  controllers: [OpportunitiesController],
  providers: [
    OpportunitiesService,
    RiskClientService,
    PaperClientService,
    PaperDiscoveryService,
    PaperDiscoveryWorker,
    AutoDriveWorker,
    // PLAN10 — live auto-execution (single-chain)
    LiveAutoDriveConfigService,
    LiveKillSwitchService,
    TokenResolverService,
    PlanSetupOrchestrator,
    LiveAutoDriveWorker,
    // PLAN12 #48 — USD price oracle client (amountIn correctness)
    LivePriceClientService,
  ],
  exports: [PaperClientService, PaperDiscoveryService],
})
export class OpportunitiesModule {}
