import type { Repository } from 'typeorm';

import type { RiskDecisionEntity } from '@arbibot/persistence';

import { RouteScoringWriterService } from './route-scoring-writer.service';
import type { RouteProfileService } from './route-profile.service';
import type { RouteScoringHistoryService } from './route-scoring-history.service';

describe('RouteScoringWriterService', () => {
  it('appends score when model or score changes', async () => {
    const routes = {
      list: jest.fn().mockResolvedValue({
        items: [{ routeKey: 'r1', maxNotionalUsd: 1_000_000, entityVersion: 1 }],
      }),
    } as unknown as RouteProfileService;
    const append = jest.fn().mockResolvedValue({ id: 'x' });
    const scoring = {
      findLatestForRoute: jest.fn().mockResolvedValue(null),
      append,
    } as unknown as RouteScoringHistoryService;
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '4', approved: '3' }),
    };
    const decisions = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as Repository<RiskDecisionEntity>;
    const svc = new RouteScoringWriterService(routes, scoring, decisions);
    process.env.ROUTE_SCORING_LOOKBACK_HOURS = '24';
    const out = await svc.runCycle();
    expect(out.routesEvaluated).toBe(1);
    expect(out.rowsWritten).toBe(1);
    expect(append).toHaveBeenCalledWith(
      'r1',
      expect.any(Number),
      'risk_v1_24h',
    );
  });

  it('skips append when latest matches score and model', async () => {
    const capRef = 5_000_000;
    const maxNotionalUsd = 1_000_000;
    const nf = Math.log10(1 + maxNotionalUsd) / Math.log10(1 + capRef);
    const approvalRatio = 0.5;
    const expectedScore =
      Math.round(
        Math.min(1, Math.max(0, 0.7 * approvalRatio + 0.3 * Math.min(1, Math.max(0, nf)))) * 1e6,
      ) / 1e6;
    const routes = {
      list: jest.fn().mockResolvedValue({
        items: [{ routeKey: 'r2', maxNotionalUsd, entityVersion: 1 }],
      }),
    } as unknown as RouteProfileService;
    const append = jest.fn();
    const scoring = {
      findLatestForRoute: jest.fn().mockResolvedValue({
        score: String(expectedScore),
        modelVersion: 'risk_v1_24h',
      }),
      append,
    } as unknown as RouteScoringHistoryService;
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total: '0', approved: null }),
    };
    const decisions = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    } as unknown as Repository<RiskDecisionEntity>;
    const svc = new RouteScoringWriterService(routes, scoring, decisions);
    process.env.ROUTE_SCORING_LOOKBACK_HOURS = '24';
    await svc.runCycle();
    expect(append).not.toHaveBeenCalled();
  });
});
