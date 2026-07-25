import { NotFoundException } from '@nestjs/common';
import type { FindManyOptions } from 'typeorm';
import type { Repository } from 'typeorm';

import { ScannerFindingEntity } from '@arbibot/persistence';

import { ScannerFindingsService } from './scanner-findings.service';

/**
 * ScannerFindingsService spec — read-only query service for `scanner_findings`.
 *
 * Covers `list()` (limit clamping [1,500], conditional where-clause building, newest-first
 * ordering) and `getById()` (NotFoundException when absent). The service was previously only
 * type-imported by scanner.controller.spec; this spec exercises it directly.
 */
describe('ScannerFindingsService', () => {
  let repo: { find: jest.Mock; findOne: jest.Mock };
  let service: ScannerFindingsService;

  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
    };
    service = new ScannerFindingsService(repo as unknown as Repository<ScannerFindingEntity>);
  });

  describe('list', () => {
    it('issues a newest-first query with take=100 when no filters are provided', async () => {
      await service.list();
      const opts = repo.find.mock.calls[0]?.[0] as FindManyOptions<ScannerFindingEntity>;
      expect(opts).toMatchObject({
        order: { observedAt: 'DESC' },
        take: 100,
      });
      expect((opts as { where?: object }).where).toEqual({});
    });

    it('clamps limit to the [1, 500] window (upper bound)', async () => {
      await service.list(undefined, undefined, 9999);
      const opts = repo.find.mock.calls[0]?.[0] as FindManyOptions<ScannerFindingEntity>;
      expect(opts.take).toBe(500);
    });

    it('clamps limit to the [1, 500] window (lower bound)', async () => {
      await service.list(undefined, undefined, 0);
      const opts = repo.find.mock.calls[0]?.[0] as FindManyOptions<ScannerFindingEntity>;
      expect(opts.take).toBe(1);
    });

    it('passes instanceId + publishStatus into the where clause when provided', async () => {
      await service.list('arb-2venue-1', 'pending', 50);
      const opts = repo.find.mock.calls[0]?.[0] as FindManyOptions<ScannerFindingEntity>;
      expect((opts as { where: object }).where).toMatchObject({
        instanceId: 'arb-2venue-1',
        publishStatus: 'pending',
      });
      expect(opts.take).toBe(50);
    });

    it('ignores empty-string filters (treats them as unset)', async () => {
      await service.list('', '', 10);
      const opts = repo.find.mock.calls[0]?.[0] as FindManyOptions<ScannerFindingEntity>;
      expect((opts as { where: object }).where).toEqual({});
    });

    it('returns the rows from the repository unchanged', async () => {
      const rows = [{ id: 'f1' }, { id: 'f2' }];
      repo.find.mockResolvedValue(rows);
      const out = await service.list();
      expect(out).toBe(rows);
    });
  });

  describe('getById', () => {
    it('returns the row when the repository finds it', async () => {
      const row = { id: 'f1', instanceId: 'arb-2venue-1' };
      repo.findOne.mockResolvedValue(row);
      const out = await service.getById('f1');
      expect(out).toBe(row);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'f1' } });
    });

    it('throws NotFoundException when the row is absent', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getById('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
