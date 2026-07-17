import type { RouteProfileEntity } from '@arbibot/persistence';
import type { Repository } from 'typeorm';

import { RouteProfileService } from './route-profile.service';

describe('RouteProfileService', () => {
  let repo: { find: jest.Mock };
  let service: RouteProfileService;

  beforeEach(() => {
    repo = { find: jest.fn() };
    service = new RouteProfileService(
      repo as unknown as Repository<RouteProfileEntity>,
    );
  });

  it('lists up to 500 rows ordered by routeKey ASC, mapped to DTO', async () => {
    repo.find.mockResolvedValue([
      {
        routeKey: 'BTC->ETH',
        maxNotionalUsd: '2000',
        entityVersion: 3,
      },
    ]);

    const result = await service.list();

    expect(repo.find).toHaveBeenCalledWith({
      order: { routeKey: 'ASC' },
      take: 500,
    });
    expect(result.items).toEqual([
      { routeKey: 'BTC->ETH', maxNotionalUsd: 2000, entityVersion: 3 },
    ]);
  });

  it('returns an empty items array when no profiles exist', async () => {
    repo.find.mockResolvedValue([]);

    const result = await service.list();

    expect(result).toEqual({ items: [] });
  });
});
