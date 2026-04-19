import { Controller, Get, Param } from '@nestjs/common';

import { RouteScoringHistoryService } from './route-scoring-history.service';
import { RouteProfileService } from './route-profile.service';
import { TokenProfileService } from './token-profile.service';
import { WatchlistTierService } from './watchlist-tier.service';

/**
 * Readiness + read APIs for Phase 2.2 policy (`P2-2.2-PROF` / `ADRISK` / `PLAY`).
 */
@Controller('policy')
export class PolicyController {
  constructor(
    private readonly tokens: TokenProfileService,
    private readonly routes: RouteProfileService,
    private readonly watchlist: WatchlistTierService,
    private readonly scoring: RouteScoringHistoryService,
  ) {}

  @Get('phase2-readiness')
  phase2Readiness(): {
    readonly tokenProfiles: 'implemented';
    readonly adaptiveRisk: 'implemented';
    readonly playbooks: 'implemented';
    readonly watchlistTiers: 'implemented';
    readonly routeScoringHistory: 'implemented';
    readonly schemaVersion: 3;
  } {
    return {
      tokenProfiles: 'implemented',
      adaptiveRisk: 'implemented',
      playbooks: 'implemented',
      watchlistTiers: 'implemented',
      routeScoringHistory: 'implemented',
      schemaVersion: 3,
    };
  }

  @Get('token-profiles')
  async listTokenProfiles(): Promise<Awaited<ReturnType<TokenProfileService['list']>>> {
    return this.tokens.list();
  }

  @Get('route-profiles')
  async listRouteProfiles(): Promise<Awaited<ReturnType<RouteProfileService['list']>>> {
    return this.routes.list();
  }

  @Get('watchlist/tiers')
  async listWatchlistTiers(): Promise<Awaited<ReturnType<WatchlistTierService['listRecent']>>> {
    return this.watchlist.listRecent(100);
  }

  @Get('route-scoring-history/:routeKey')
  async listRouteScoring(
    @Param('routeKey') routeKey: string,
  ): Promise<Awaited<ReturnType<RouteScoringHistoryService['listForRoute']>>> {
    return this.scoring.listForRoute(routeKey, 200);
  }
}
