import type { TokenProfileEntity } from '@arbibot/persistence';
import type { Repository } from 'typeorm';

import { TokenProfileService } from './token-profile.service';

describe('TokenProfileService', () => {
  let repo: { find: jest.Mock };
  let service: TokenProfileService;

  beforeEach(() => {
    repo = { find: jest.fn() };
    service = new TokenProfileService(
      repo as unknown as Repository<TokenProfileEntity>,
    );
  });

  it('lists up to 500 rows ordered by instrumentKey ASC, mapped to DTO', async () => {
    repo.find.mockResolvedValue([
      {
        instrumentKey: 'BTC-USDT',
        maxNotionalUsd: '1500',
        entityVersion: 2,
      },
      {
        instrumentKey: 'ETH-USDT',
        maxNotionalUsd: '800',
        entityVersion: 1,
      },
    ]);

    const result = await service.list();

    expect(repo.find).toHaveBeenCalledWith({
      order: { instrumentKey: 'ASC' },
      take: 500,
    });
    expect(result.items).toEqual([
      { instrumentKey: 'BTC-USDT', maxNotionalUsd: 1500, entityVersion: 2 },
      { instrumentKey: 'ETH-USDT', maxNotionalUsd: 800, entityVersion: 1 },
    ]);
  });

  it('returns an empty items array when no profiles exist', async () => {
    repo.find.mockResolvedValue([]);

    const result = await service.list();

    expect(result).toEqual({ items: [] });
  });
});
