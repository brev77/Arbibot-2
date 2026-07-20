 
import type { ArbitrageOpportunityEntity } from '@arbibot/persistence';
import type { Repository } from 'typeorm';

import { PaperDiscoveryService } from './paper-discovery.service';

/**
 * PaperDiscoveryService spec — covers the full happy/error/idempotent paths
 * for paper-only opportunity discovery.
 *
 * Pattern A: direct instantiation with a stub Repository. Only one method
 * to test (`discoverPaperOpportunities`).
 */
describe('PaperDiscoveryService', () => {
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let service: PaperDiscoveryService;

  const origEnv = process.env.PAPER_DISCOVERY_INSTRUMENT_KEYS;

  beforeEach(() => {
    delete process.env.PAPER_DISCOVERY_INSTRUMENT_KEYS;
    repo = {
      create: jest.fn((values) => ({ ...values })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      createQueryBuilder: jest.fn(),
    };
    service = new PaperDiscoveryService(repo as unknown as Repository<ArbitrageOpportunityEntity>);
  });

  afterAll(() => {
    if (origEnv === undefined) {
      delete process.env.PAPER_DISCOVERY_INSTRUMENT_KEYS;
    } else {
      process.env.PAPER_DISCOVERY_INSTRUMENT_KEYS = origEnv;
    }
  });

  function chainReturning(row: ArbitrageOpportunityEntity | null) {
    const chain = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(row),
    };
    repo.createQueryBuilder.mockReturnValue(chain);
    return chain;
  }

  describe('discoverPaperOpportunities', () => {
    it('uses default [BTC, ETH] keys when env is unset', async () => {
      chainReturning(null);
      const result = await service.discoverPaperOpportunities();
      expect(result).toEqual({ discovered: 2, errors: 0 });
      expect(repo.save).toHaveBeenCalledTimes(2);
    });

    it('uses default keys when env is whitespace-only', async () => {
      process.env.PAPER_DISCOVERY_INSTRUMENT_KEYS = '   ';
      chainReturning(null);
      const result = await service.discoverPaperOpportunities();
      expect(result).toEqual({ discovered: 2, errors: 0 });
    });

    it('parses comma-separated keys from env (trims whitespace, drops empties)', async () => {
      process.env.PAPER_DISCOVERY_INSTRUMENT_KEYS = '  BTC, , ETH,USDC  ';
      chainReturning(null);
      const result = await service.discoverPaperOpportunities();
      expect(result).toEqual({ discovered: 3, errors: 0 });
      expect(repo.save).toHaveBeenCalledTimes(3);
    });

    it('skips tokens that already have a discovered opportunity (idempotent)', async () => {
      // First token (BTC) exists, others do not
      let calls = 0;
      repo.createQueryBuilder.mockImplementation(() => {
        calls++;
        return {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(calls === 1 ? ({ id: 'existing' } as ArbitrageOpportunityEntity) : null),
        };
      });

      const result = await service.discoverPaperOpportunities();
      expect(result).toEqual({ discovered: 1, errors: 0 }); // BTC skipped, ETH created
      expect(repo.save).toHaveBeenCalledTimes(1);
    });

    it('creates opportunities with detected state + paper_discovery payload', async () => {
      chainReturning(null);
      await service.discoverPaperOpportunities();

      const createCall = repo.create.mock.calls[0][0];
      expect(createCall.state).toBe('detected');
      expect(createCall.entityVersion).toBe(1);
      expect(createCall.payload).toEqual(
        expect.objectContaining({
          source: 'paper_discovery',
          tokenKey: 'BTC',
          instrumentKey: 'paper.discovery:BTC',
        }),
      );
      expect(createCall.correlationId).toBeNull();
      expect(createCall.riskDecisionId).toBeNull();
    });

    it('counts errors when save throws', async () => {
      chainReturning(null);
      repo.save.mockRejectedValue(new Error('db down'));

      const result = await service.discoverPaperOpportunities();
      expect(result).toEqual({ discovered: 0, errors: 2 });
    });

    it('counts errors when createQueryBuilder.getOne throws', async () => {
      const chain = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockRejectedValue(new Error('rpc fail')),
      };
      repo.createQueryBuilder.mockReturnValue(chain);

      const result = await service.discoverPaperOpportunities();
      expect(result).toEqual({ discovered: 0, errors: 2 });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('counts mixed: one token errors, other succeeds', async () => {
      repo.createQueryBuilder.mockImplementation(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      }));
      repo.save
        .mockRejectedValueOnce(new Error('first fails'))
        .mockResolvedValueOnce({ id: 'second-ok' });

      const result = await service.discoverPaperOpportunities();
      expect(result).toEqual({ discovered: 1, errors: 1 });
    });

    it('uses createQueryBuilder with alias "o" and filters by instrumentKey + source', async () => {
      const chain = chainReturning(null);
      await service.discoverPaperOpportunities();

      expect(repo.createQueryBuilder).toHaveBeenCalledWith('o');
      expect(chain.where).toHaveBeenCalled();
      // The where clause contains "instrumentKey" and the andWhere contains "source"
      const whereArg = chain.where.mock.calls[0][0] as string;
      const andArg = chain.andWhere.mock.calls[0][0] as string;
      expect(whereArg).toMatch(/instrumentKey/i);
      expect(andArg).toMatch(/source/);
    });
  });
});
