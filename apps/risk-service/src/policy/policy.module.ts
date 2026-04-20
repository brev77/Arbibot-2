import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  RiskDecisionEntity,
  RouteProfileEntity,
  RouteScoringHistoryEntity,
  TokenProfileEntity,
  WatchlistTierSnapshotEntity,
} from '@arbibot/persistence';

import { AdaptiveRiskService } from './adaptive-risk.service';
import { PolicyController } from './policy.controller';
import { PolicyJobsController } from './policy-jobs.controller';
import { PolicyJobsService } from './policy-jobs.service';
import { RouteProfileService } from './route-profile.service';
import { RouteScoringHistoryService } from './route-scoring-history.service';
import { RouteScoringWriterService } from './route-scoring-writer.service';
import { TokenProfileService } from './token-profile.service';
import { WatchlistTierService } from './watchlist-tier.service';
import { WatchlistTieringWriterService } from './watchlist-tiering-writer.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TokenProfileEntity,
      RouteProfileEntity,
      WatchlistTierSnapshotEntity,
      RouteScoringHistoryEntity,
      RiskDecisionEntity,
    ]),
  ],
  controllers: [PolicyController, PolicyJobsController],
  providers: [
    TokenProfileService,
    RouteProfileService,
    AdaptiveRiskService,
    WatchlistTierService,
    RouteScoringHistoryService,
    WatchlistTieringWriterService,
    RouteScoringWriterService,
    PolicyJobsService,
  ],
  exports: [
    TokenProfileService,
    RouteProfileService,
    AdaptiveRiskService,
    WatchlistTierService,
    RouteScoringHistoryService,
    WatchlistTieringWriterService,
    RouteScoringWriterService,
    PolicyJobsService,
  ],
})
export class PolicyModule {}
