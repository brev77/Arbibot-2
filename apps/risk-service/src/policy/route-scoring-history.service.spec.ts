import { BadRequestException } from '@nestjs/common';
import type { RouteScoringHistoryEntity } from '@arbibot/persistence';
import type { Repository } from 'typeorm';

import { RouteScoringHistoryService } from './route-scoring-history.service';

describe('RouteScoringHistoryService', () => {
  let repo: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
  };
  let service: RouteScoringHistoryService;

  const mkRow = (
    over: Partial<RouteScoringHistoryEntity> = {},
  ): RouteScoringHistoryEntity => ({
    id: 'rsh-1',
    routeKey: 'BTC->ETH',
    score: '0.92',
    modelVersion: 'v1',
    recordedAt: new Date('2026-07-17T10:00:00Z'),
    ...over,
  });

  beforeEach(() => {
    repo = {
      find: jest.fn(),
      create: jest.fn((values) => ({ ...values })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      findOne: jest.fn(),
    };
    service = new RouteScoringHistoryService(
      repo as unknown as Repository<RouteScoringHistoryEntity>,
    );
  });

  describe('listForRoute', () => {
    it('returns rows mapped to ISO-date DTOs, ordered DESC, take-limited', async () => {
      repo.find.mockResolvedValue([mkRow()]);

      const result = await service.listForRoute('BTC->ETH', 200);

      expect(repo.find).toHaveBeenCalledWith({
        where: { routeKey: 'BTC->ETH' },
        order: { recordedAt: 'DESC' },
        take: 200,
      });
      expect(result.items).toEqual([
        {
          id: 'rsh-1',
          routeKey: 'BTC->ETH',
          score: 0.92,
          modelVersion: 'v1',
          recordedAtIso: '2026-07-17T10:00:00.000Z',
        },
      ]);
    });

    it('trims the routeKey before querying', async () => {
      repo.find.mockResolvedValue([]);
      await service.listForRoute('  BTC->ETH  ', 50);
      expect(repo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { routeKey: 'BTC->ETH' } }),
      );
    });

    it('throws BadRequestException when routeKey is empty/whitespace', async () => {
      await expect(service.listForRoute('', 50)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.listForRoute('   ', 50)).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.find).not.toHaveBeenCalled();
    });
  });

  describe('append', () => {
    it('creates a row with trimmed routeKey + stringified score and saves it', async () => {
      await service.append('  BTC->ETH  ', 0.5, 'v2');

      expect(repo.create).toHaveBeenCalledWith({
        routeKey: 'BTC->ETH',
        score: '0.5',
        modelVersion: 'v2',
      });
      expect(repo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('findLatestForRoute', () => {
    it('returns the latest row by recordedAt DESC', async () => {
      const latest = mkRow({ id: 'latest' });
      repo.findOne.mockResolvedValue(latest);

      const result = await service.findLatestForRoute('BTC->ETH');

      expect(result).toBe(latest);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { routeKey: 'BTC->ETH' },
        order: { recordedAt: 'DESC' },
      });
    });

    it('returns null when routeKey is empty (no query made)', async () => {
      const result = await service.findLatestForRoute('   ');
      expect(result).toBeNull();
      expect(repo.findOne).not.toHaveBeenCalled();
    });

    it('returns null when no row exists', async () => {
      repo.findOne.mockResolvedValue(null);
      const result = await service.findLatestForRoute('UNKNOWN');
      expect(result).toBeNull();
    });
  });
});
