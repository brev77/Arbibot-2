import { PolicyController } from './policy.controller';
import { RouteProfileService } from './route-profile.service';
import { RouteScoringHistoryService } from './route-scoring-history.service';
import { TokenProfileService } from './token-profile.service';
import { WatchlistTierService } from './watchlist-tier.service';

/**
 * PolicyController spec (Phase 4 — risk-service policy read API coverage).
 *
 * Read-only Phase 2.2 policy endpoints. Each handler delegates to a service;
 * the only controller-level concern is the readiness manifest + the limit
 * arguments passed to listRecent/listForRoute.
 */
describe('PolicyController', () => {
  let tokens: { list: jest.Mock };
  let routes: { list: jest.Mock };
  let watchlist: { listRecent: jest.Mock };
  let scoring: { listForRoute: jest.Mock };
  let controller: PolicyController;

  beforeEach(() => {
    tokens = { list: jest.fn() };
    routes = { list: jest.fn() };
    watchlist = { listRecent: jest.fn() };
    scoring = { listForRoute: jest.fn() };
    controller = new PolicyController(
      tokens as unknown as TokenProfileService,
      routes as unknown as RouteProfileService,
      watchlist as unknown as WatchlistTierService,
      scoring as unknown as RouteScoringHistoryService,
    );
  });

  it('phase2Readiness returns the static capability manifest (schemaVersion 3)', () => {
    const result = controller.phase2Readiness();

    expect(result).toEqual({
      tokenProfiles: 'implemented',
      adaptiveRisk: 'implemented',
      playbooks: 'implemented',
      watchlistTiers: 'implemented',
      routeScoringHistory: 'implemented',
      schemaVersion: 3,
    });
  });

  it('listTokenProfiles delegates to TokenProfileService.list', async () => {
    const items = [{ tokenKey: 'BTC' }];
    tokens.list.mockResolvedValue(items);

    const result = await controller.listTokenProfiles();

    expect(result).toBe(items);
    expect(tokens.list).toHaveBeenCalledTimes(1);
  });

  it('listRouteProfiles delegates to RouteProfileService.list', async () => {
    const items = [{ routeKey: 'BTC->ETH' }];
    routes.list.mockResolvedValue(items);

    const result = await controller.listRouteProfiles();

    expect(result).toBe(items);
  });

  it('listWatchlistTiers delegates with limit=100 (newest first)', async () => {
    const tiers = [{ tier: 'green' }];
    watchlist.listRecent.mockResolvedValue(tiers);

    const result = await controller.listWatchlistTiers();

    expect(result).toBe(tiers);
    expect(watchlist.listRecent).toHaveBeenCalledWith(100);
  });

  it('listRouteScoring delegates with the route key + limit=200', async () => {
    const history = [{ routeKey: 'BTC->ETH', score: 0.9 }];
    scoring.listForRoute.mockResolvedValue(history);

    const result = await controller.listRouteScoring('BTC-%3EETH');

    expect(result).toBe(history);
    expect(scoring.listForRoute).toHaveBeenCalledWith('BTC-%3EETH', 200);
  });

  it('listRouteScoring forwards an empty route key unchanged', async () => {
    scoring.listForRoute.mockResolvedValue([]);
    await controller.listRouteScoring('');
    expect(scoring.listForRoute).toHaveBeenCalledWith('', 200);
  });
});
