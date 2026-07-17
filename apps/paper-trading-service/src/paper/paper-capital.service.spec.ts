import type { PaperCapitalReservationEntity } from '@arbibot/persistence';
import type { Repository } from 'typeorm';

import { PaperCapitalService } from './paper-capital.service';

/**
 * PaperCapitalService spec (P3-3 virtual capital, risk tracker H5).
 *
 * Pattern A: direct instantiation with a lightweight Repository mock. The
 * service is a thin state-machine wrapper around the PaperCapitalReservation
 * repo (active -> expired), so all logic is exercisable through create/save/
 * findOne/createQueryBuilder stubs. No DB/Redis/Nest module bootstrap.
 */
describe('PaperCapitalService', () => {
  let service: PaperCapitalService;
  let repo: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };

  const mkReservation = (
    over: Partial<PaperCapitalReservationEntity> = {},
  ): PaperCapitalReservationEntity => ({
    id: 'r-1',
    instrumentKey: 'BTC-USDT',
    notional: '100',
    state: 'active',
    expiresAt: new Date('2026-07-17T13:00:00Z'),
    entityVersion: 1,
    createdAt: new Date('2026-07-17T12:00:00Z'),
    updatedAt: new Date('2026-07-17T12:00:00Z'),
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    repo = {
      create: jest.fn((values) => ({ ...values })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    service = new PaperCapitalService(
      repo as unknown as Repository<PaperCapitalReservationEntity>,
    );
  });

  describe('reserveCapital', () => {
    it('creates an active reservation with a 60-minute TTL and persists it', async () => {
      const before = Date.now();
      repo.save.mockResolvedValue(mkReservation());

      await service.reserveCapital('BTC-USDT', '100');

      // create() receives instrumentKey/notional + state=active + entityVersion=1
      // and an expiresAt ~60min in the future.
      expect(repo.create).toHaveBeenCalledTimes(1);
      const createdArg = repo.create.mock.calls[0]![0];
      expect(createdArg).toMatchObject({
        instrumentKey: 'BTC-USDT',
        notional: '100',
        state: 'active',
        entityVersion: 1,
      });
      const expiresAt = createdArg.expiresAt as Date;
      expect(expiresAt.getTime()).toBeGreaterThan(before + 59 * 60 * 1000);
      expect(expiresAt.getTime()).toBeLessThan(before + 61 * 60 * 1000);

      // save() receives the object create() returned (i.e. the reservation
      // built inside the service), not the literal arg.
      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(repo.save.mock.calls[0]![0]).toBe(repo.create.mock.results[0]!.value);
    });

    it('returns the persisted reservation', async () => {
      const saved = mkReservation({ id: 'persisted-id' });
      repo.save.mockResolvedValue(saved);

      const result = await service.reserveCapital('ETH-USDT', '250');

      expect(result).toBe(saved);
    });
  });

  describe('getActiveReservation', () => {
    it('queries by instrumentKey + state=active, newest first', async () => {
      const active = mkReservation({ id: 'newest' });
      repo.findOne.mockResolvedValue(active);

      const result = await service.getActiveReservation('BTC-USDT');

      expect(result).toBe(active);
      expect(repo.findOne).toHaveBeenCalledTimes(1);
      expect(repo.findOne).toHaveBeenCalledWith({
        where: { instrumentKey: 'BTC-USDT', state: 'active' },
        order: { createdAt: 'DESC' },
      });
    });

    it('returns null when no active reservation exists', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.getActiveReservation('UNKNOWN');

      expect(result).toBeNull();
    });
  });

  describe('expireReservation', () => {
    it('returns null when the reservation is not found', async () => {
      repo.findOne.mockResolvedValue(null);

      const result = await service.expireReservation('missing-id');

      expect(result).toBeNull();
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('is a no-op (returns as-is, no save) when already non-active', async () => {
      const expired = mkReservation({ id: 'r-1', state: 'expired', entityVersion: 2 });
      repo.findOne.mockResolvedValue(expired);

      const result = await service.expireReservation('r-1');

      expect(result).toBe(expired);
      expect(result!.state).toBe('expired');
      // No state mutation, no save — idempotent on terminal state.
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('flips active -> expired, bumps entityVersion, and saves', async () => {
      const active = mkReservation({ id: 'r-1', state: 'active', entityVersion: 1 });
      repo.findOne.mockResolvedValue(active);
      repo.save.mockResolvedValue(active);

      const result = await service.expireReservation('r-1');

      expect(active.state).toBe('expired');
      expect(active.entityVersion).toBe(2);
      expect(repo.save).toHaveBeenCalledWith(active);
      expect(result).toBe(active);
    });
  });

  describe('expireReservations (background TTL sweep)', () => {
    /** Build the chained query-builder mock the service drives in expireReservations. */
    const buildChainedQb = (affected: number | undefined) => {
      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected }),
      };
      return qb;
    };

    it('bulk-updates active rows past expires_at and returns the affected count', async () => {
      const qb = buildChainedQb(7);
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.expireReservations();

      expect(result).toBe(7);
      // State filter + TTL filter both applied.
      expect(qb.update).toHaveBeenCalledWith(expect.any(Function));
      expect(qb.set).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'expired',
          entityVersion: expect.any(Function),
          updatedAt: expect.any(Date),
        }),
      );
      expect(qb.where).toHaveBeenCalledWith('state = :state', { state: 'active' });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'expires_at <= :now',
        expect.objectContaining({ now: expect.any(Date) }),
      );
    });

    it('returns 0 when no rows are affected (nothing to expire)', async () => {
      const qb = buildChainedQb(0);
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.expireReservations();

      expect(result).toBe(0);
    });

    it('returns 0 when affected is undefined (driver did not report count)', async () => {
      const qb = buildChainedQb(undefined);
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.expireReservations();

      expect(result).toBe(0);
    });
  });
});
