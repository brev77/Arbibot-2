import { ConflictException, NotFoundException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';

import { ReconciliationMismatchEntity } from '@arbibot/persistence';

import { MismatchesService } from './mismatches.service';

describe('MismatchesService', () => {
  it('runDetectors sums inserted rows from all detectors', async () => {
    const query = jest
      .fn()
      // Legacy detector 1: completed_plan_missing_portfolio
      .mockResolvedValueOnce([{ id: '1' }])
      // Legacy detector 2: executing_plan_legs_filled_not_completed
      .mockResolvedValueOnce([{ id: '2' }, { id: '3' }])
      // DEX detector 1: dex_receipt_leg_mismatch
      .mockResolvedValueOnce([{ id: '4' }])
      // DEX detector 2: wallet_balance_drift
      .mockResolvedValueOnce([])
      // DEX detector 3: dex_stale_pending_tx
      .mockResolvedValueOnce([{ id: '5' }, { id: '6' }]);
    const dataSource = { query } as never;
    const repo = {
      find: jest.fn(),
    } as unknown as Repository<ReconciliationMismatchEntity>;
    const svc = new MismatchesService(dataSource, repo);
    const r = await svc.runDetectors();
    expect(r.inserted).toBe(6);
    expect(r.byKind).toMatchObject({
      completed_plan_missing_portfolio: 1,
      executing_plan_legs_filled_not_completed: 2,
      dex_receipt_leg_mismatch: 1,
      wallet_balance_drift: 0,
      dex_stale_pending_tx: 2,
    });
    // 2 legacy + 3 DEX detectors = 5 total query calls
    expect(query).toHaveBeenCalledTimes(5);
  });

  describe('list', () => {
    it('returns rows ordered newest-first, take 200', async () => {
      const find = jest.fn().mockResolvedValue([
        { id: 'm-1', kind: 'k', status: 'open', details: {}, entityVersion: 1, createdAt: new Date(), updatedAt: new Date() },
      ]);
      const repo = { find } as unknown as Repository<ReconciliationMismatchEntity>;
      const dataSource = { query: jest.fn() } as unknown as DataSource;
      const svc = new MismatchesService(dataSource, repo);

      const rows = await svc.list();

      expect(rows).toHaveLength(1);
      expect(find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' }, take: 200 });
    });

    it('returns an empty array when no mismatches exist', async () => {
      const find = jest.fn().mockResolvedValue([]);
      const repo = { find } as unknown as Repository<ReconciliationMismatchEntity>;
      const dataSource = { query: jest.fn() } as unknown as DataSource;
      const svc = new MismatchesService(dataSource, repo);

      expect(await svc.list()).toEqual([]);
    });
  });

  describe('updateStatus', () => {
    /** Build a transaction mock that hands the callback a fake EntityManager. */
    const mkTx = (
      findOneImpl: jest.Mock,
      saveImpl: jest.Mock,
    ): { dataSource: DataSource; em: { findOne: jest.Mock; save: jest.Mock } } => {
      const em = { findOne: findOneImpl, save: saveImpl };
      const transaction = jest.fn(async (cb: (em: unknown) => Promise<unknown>) =>
        cb(em),
      );
      return { dataSource: { transaction } as unknown as DataSource, em };
    };

    const baseRow = () => ({
      id: 'm-1',
      kind: 'k',
      status: 'open',
      details: {},
      entityVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('locks, updates status, bumps entityVersion, and saves', async () => {
      const row = baseRow();
      const save = jest.fn().mockResolvedValue(row);
      const { dataSource, em } = mkTx(jest.fn().mockResolvedValue(row), save);
      const repo = { find: jest.fn() } as unknown as Repository<ReconciliationMismatchEntity>;
      const svc = new MismatchesService(dataSource, repo);

      const result = await svc.updateStatus('m-1', { status: 'resolved' });

      // Pessimistic write lock requested.
      expect(em.findOne).toHaveBeenCalledWith(
        ReconciliationMismatchEntity,
        expect.objectContaining({
          where: { id: 'm-1' },
          lock: { mode: 'pessimistic_write' },
        }),
      );
      expect(row.status).toBe('resolved');
      expect(row.entityVersion).toBe(2);
      expect(save).toHaveBeenCalledWith(row);
      expect(result).toBe(row);
    });

    it('throws NotFoundException when the row does not exist', async () => {
      const { dataSource } = mkTx(jest.fn().mockResolvedValue(null), jest.fn());
      const repo = { find: jest.fn() } as unknown as Repository<ReconciliationMismatchEntity>;
      const svc = new MismatchesService(dataSource, repo);

      await expect(
        svc.updateStatus('missing', { status: 'resolved' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException on stale expectedEntityVersion', async () => {
      const row = baseRow(); // entityVersion 1
      const { dataSource } = mkTx(jest.fn().mockResolvedValue(row), jest.fn());
      const repo = { find: jest.fn() } as unknown as Repository<ReconciliationMismatchEntity>;
      const svc = new MismatchesService(dataSource, repo);

      await expect(
        svc.updateStatus('m-1', { status: 'resolved', expectedEntityVersion: 99 }),
      ).rejects.toThrow(ConflictException);
    });

    it('skips the version check when expectedEntityVersion is omitted', async () => {
      const row = baseRow();
      const save = jest.fn().mockResolvedValue(row);
      const { dataSource } = mkTx(jest.fn().mockResolvedValue(row), save);
      const repo = { find: jest.fn() } as unknown as Repository<ReconciliationMismatchEntity>;
      const svc = new MismatchesService(dataSource, repo);

      await svc.updateStatus('m-1', { status: 'investigating' });

      expect(row.status).toBe('investigating');
      expect(save).toHaveBeenCalled();
    });

    it('passes when expectedEntityVersion matches the persisted version', async () => {
      const row = baseRow();
      const save = jest.fn().mockResolvedValue(row);
      const { dataSource } = mkTx(jest.fn().mockResolvedValue(row), save);
      const repo = { find: jest.fn() } as unknown as Repository<ReconciliationMismatchEntity>;
      const svc = new MismatchesService(dataSource, repo);

      await svc.updateStatus('m-1', { status: 'resolved', expectedEntityVersion: 1 });

      expect(save).toHaveBeenCalled();
    });
  });
});
