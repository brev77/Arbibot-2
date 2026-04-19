import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  RouteProfileEntity,
  RouteScoringHistoryEntity,
  TokenProfileEntity,
  WatchlistTierSnapshotEntity,
} from '@arbibot/persistence';

import { AdaptiveRiskService } from './adaptive-risk.service';
import { PolicyController } from './policy.controller';
import { RouteProfileService } from './route-profile.service';
import { RouteScoringHistoryService } from './route-scoring-history.service';
import { TokenProfileService } from './token-profile.service';
import { WatchlistTierService } from './watchlist-tier.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TokenProfileEntity,
      RouteProfileEntity,
      WatchlistTierSnapshotEntity,
      RouteScoringHistoryEntity,
    ]),
  ],
  controllers: [PolicyController],
  providers: [
    TokenProfileService,
    RouteProfileService,
    AdaptiveRiskService,
    WatchlistTierService,
    RouteScoringHistoryService,
  ],
  exports: [
    TokenProfileService,
    RouteProfileService,
    AdaptiveRiskService,
    WatchlistTierService,
    RouteScoringHistoryService,
  ],
})
export class PolicyModule {}
