import type { WatchlistTierSnapshotEntity } from '@arbibot/persistence';
import type { Repository, SelectQueryBuilder } from 'typeorm';

import { WatchlistTierService } from './watchlist-tier.service';

describe('WatchlistTierService', () => {
  let repo: {
    createQueryBuilder: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let service: WatchlistTierService;

  const mkRow = (
    over: Partial<WatchlistTierSnapshotEntity> = {},
  ): WatchlistTierSnapshotEntity => ({
    id: 'wts-1',
    instrumentKey: 'BTC-USDT',
    tier: 'green',
    reason: 'stable liquidity',
    recordedAt: new Date('2026-07-17T10:00:00Z'),
    ...over,
  });

  /** Build the chained query-builder mock listRecent drives. */
  const chainedQb = (rows: WatchlistTierSnapshotEntity[]) => {
    const qb: SelectQueryBuilder<WatchlistTierSnapshotEntity> = {
      distinctOn: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    } as unknown as SelectQueryBuilder<WatchlistTierSnapshotEntity>;
    return qb;
  };

  beforeEach(() => {
    repo = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((values) => ({ ...values })),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };
    service = new WatchlistTierService(
      repo as unknown as Repository<WatchlistTierSnapshotEntity>,
    );
  });

  describe('listRecent', () => {
    it('queries distinct-on instrument, newest-first, take clamped to [1, 500]', async () => {
      const qb = chainedQb([mkRow()]);
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.listRecent(100);

      expect(qb.distinctOn).toHaveBeenCalledWith(['w.instrumentKey']);
      expect(qb.orderBy).toHaveBeenCalledWith('w.instrumentKey', 'ASC');
      expect(qb.addOrderBy).toHaveBeenCalledWith('w.recordedAt', 'DESC');
      expect(qb.take).toHaveBeenCalledWith(100);
      expect(result.items).toEqual([
        {
          id: 'wts-1',
          instrumentKey: 'BTC-USDT',
          tier: 'green',
          reason: 'stable liquidity',
          recordedAtIso: '2026-07-17T10:00:00.000Z',
        },
      ]);
    });

    it('clamps take to 1 when caller passes 0 or negative', async () => {
      const qb = chainedQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);

      await service.listRecent(0);
      expect(qb.take).toHaveBeenCalledWith(1);
    });

    it('clamps take to 500 when caller exceeds the cap', async () => {
      const qb = chainedQb([]);
      repo.createQueryBuilder.mockReturnValue(qb);

      await service.listRecent(9999);
      expect(qb.take).toHaveBeenCalledWith(500);
    });
  });

  describe('findLatestForInstrument', () => {
    it('returns the latest row by recordedAt DESC for the given instrument', async () => {
      const latest = mkRow({ id: 'latest' });
      repo.findOne.mockResolvedValue(latest);

      const result = await service.findLatestForInstrument('BTC-USDT');

      expect(result).toBe(latest);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { instrumentKey: 'BTC-USDT' },
        order: { recordedAt: 'DESC' },
      });
    });

    it('returns null when no snapshot exists', async () => {
      repo.findOne.mockResolvedValue(null);
      expect(await service.findLatestForInstrument('X')).toBeNull();
    });
  });

  describe('recordSnapshot', () => {
    it('creates a row with instrument/tier/reason and saves it', async () => {
      await service.recordSnapshot('BTC-USDT', 'red', 'drift spike');

      expect(repo.create).toHaveBeenCalledWith({
        instrumentKey: 'BTC-USDT',
        tier: 'red',
        reason: 'drift spike',
      });
      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });
});
