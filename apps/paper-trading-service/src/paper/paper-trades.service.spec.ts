import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { AuditClientService } from '@arbibot/nest-platform';
import { PaperTradeEntity } from '@arbibot/persistence';

import { PaperCapitalService } from './paper-capital.service';
import { PaperTradesService } from './paper-trades.service';

const mkAudit = (): AuditClientService =>
  ({
    appendEntry: jest.fn().mockResolvedValue(undefined),
  }) as unknown as AuditClientService;

const mkCapital = (): PaperCapitalService =>
  ({
    reserveCapital: jest.fn().mockResolvedValue(undefined),
    getActiveReservation: jest.fn().mockResolvedValue(null),
    expireReservation: jest.fn().mockResolvedValue(undefined),
    expireReservations: jest.fn().mockResolvedValue(0),
  }) as unknown as PaperCapitalService;

describe('PaperTradesService', () => {
  it('builds with mocked repository', () => {
    const repo = {} as never;
    const svc = new PaperTradesService(repo, mkAudit(), mkCapital());
    expect(svc).toBeDefined();
  });

  describe('list / getById', () => {
    it('list forwards DESC updatedAt take=200 to repository', async () => {
      const find = jest.fn().mockResolvedValue([]);
      const repo = { find } as never;
      const svc = new PaperTradesService(repo, mkAudit(), mkCapital());
      await svc.list();
      expect(find.mock.calls[0]?.[0]).toMatchObject({
        order: { updatedAt: 'DESC' },
        take: 200,
      });
    });

    it('getById forwards the id to findOne', async () => {
      const findOne = jest.fn().mockResolvedValue(null);
      const repo = { findOne } as never;
      const svc = new PaperTradesService(repo, mkAudit(), mkCapital());
      await svc.getById('t1');
      expect(findOne.mock.calls[0]?.[0]).toMatchObject({ where: { id: 't1' } });
    });
  });

  describe('create', () => {
    it('returns existing row when idempotencyKey matches', async () => {
      const existing = { id: 't1', instrumentKey: 'BTC-USDT', idempotencyKey: 'idem-1' };
      const repo = {
        findOne: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
        save: jest.fn(),
      } as never;
      const svc = new PaperTradesService(repo, mkAudit(), mkCapital());
      const out = await svc.create({
        instrumentKey: 'BTC-USDT',
        idempotencyKey: 'idem-1',
      });
      expect(out).toBe(existing);
      expect((repo as { save: jest.Mock }).save).not.toHaveBeenCalled();
    });

    it('persists new row without idempotencyKey', async () => {
      const create = jest.fn((p) => p);
      const save = jest.fn((row) => Promise.resolve(row));
      const repo = {
        findOne: jest.fn(),
        create,
        save,
      } as never;
      const svc = new PaperTradesService(repo, mkAudit(), mkCapital());
      const out = await svc.create({ instrumentKey: 'BTC-USDT', notional: '100' });
      expect(out.instrumentKey).toBe('BTC-USDT');
      const created0 = create.mock.calls[0]?.[0];
      expect(created0.state).toBe('draft');
      expect(created0.notional).toBe('100');
      expect(created0.idempotencyKey).toBeNull();
    });

    it('defaults notional to "0" and summary to {} when omitted', async () => {
      const create = jest.fn((p) => p);
      const save = jest.fn((row) => Promise.resolve(row));
      const repo = {
        findOne: jest.fn(),
        create,
        save,
      } as never;
      const svc = new PaperTradesService(repo, mkAudit(), mkCapital());
      await svc.create({ instrumentKey: 'BTC-USDT' });
      const created0 = create.mock.calls[0]?.[0];
      expect(created0.notional).toBe('0');
      expect(created0.summary).toEqual({});
    });

    it('replays on unique violation when idempotencyKey set', async () => {
      let saveAttempted = false;
      const replay = { id: 't2', instrumentKey: 'ETH-USDT', idempotencyKey: 'idem-2' };
      const repo = {
        findOne: jest.fn((opts: { where: { idempotencyKey?: string } }) => {
          if (opts.where.idempotencyKey !== 'idem-2') return null;
          return saveAttempted ? replay : null;
        }),
        create: jest.fn((p) => p),
        save: jest.fn(() => {
          saveAttempted = true;
          throw new QueryFailedError(
            'INSERT',
            [],
            Object.assign(new Error('dup'), { code: '23505' }),
          );
        }),
      } as never;
      const svc = new PaperTradesService(repo, mkAudit(), mkCapital());
      const out = await svc.create({
        instrumentKey: 'ETH-USDT',
        idempotencyKey: 'idem-2',
      });
      expect(out.id).toBe('t2');
    });

    it('rethrows non-unique-violation errors on save', async () => {
      const repo = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((p) => p),
        save: jest.fn(() => {
          throw new Error('connection refused');
        }),
      } as never;
      const svc = new PaperTradesService(repo, mkAudit(), mkCapital());
      await expect(
        svc.create({ instrumentKey: 'BTC-USDT', idempotencyKey: 'idem-x' }),
      ).rejects.toThrow('connection refused');
    });

    it('rethrows unique-violation when replay row not found', async () => {
      const repo = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((p) => p),
        save: jest.fn(() => {
          throw new QueryFailedError(
            'INSERT',
            [],
            Object.assign(new Error('dup'), { code: '23505' }),
          );
        }),
      } as never;
      const svc = new PaperTradesService(repo, mkAudit(), mkCapital());
      await expect(
        svc.create({ instrumentKey: 'BTC-USDT', idempotencyKey: 'idem-y' }),
      ).rejects.toBeInstanceOf(QueryFailedError);
    });
  });

  describe('patch (transaction + state machine)', () => {
    type Em = {
      findOne: jest.Mock;
      save: jest.Mock;
    };
    const mkEm = (row: Partial<PaperTradeEntity> | null): Em => ({
      findOne: jest.fn().mockResolvedValue(row),
      save: jest.fn((_e: unknown, saved: unknown) => Promise.resolve(saved)),
    });
    const mkRepo = (em: Em) =>
      ({
        manager: {
          transaction: jest.fn(
            (fn: (em: unknown) => Promise<unknown>) => Promise.resolve(fn(em)),
          ),
        },
      }) as never;

    it('throws NotFoundException when row does not exist', async () => {
      const em = mkEm(null);
      const svc = new PaperTradesService(mkRepo(em), mkAudit(), mkCapital());
      await expect(
        svc.patch('p1', { expectedVersion: 1, state: 'active' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException on entityVersion mismatch', async () => {
      const em = mkEm({ id: 'p1', state: 'draft', entityVersion: 5 });
      const svc = new PaperTradesService(mkRepo(em), mkAudit(), mkCapital());
      await expect(
        svc.patch('p1', { expectedVersion: 1, state: 'active' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws BadRequestException when neither state nor notional provided', async () => {
      const em = mkEm({ id: 'p1', state: 'draft', entityVersion: 1 });
      const svc = new PaperTradesService(mkRepo(em), mkAudit(), mkCapital());
      await expect(
        svc.patch('p1', { expectedVersion: 1 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws ConflictException on invalid state transition (settled → active)', async () => {
      const em = mkEm({ id: 'p1', state: 'settled', entityVersion: 1 });
      const svc = new PaperTradesService(mkRepo(em), mkAudit(), mkCapital());
      await expect(
        svc.patch('p1', { expectedVersion: 1, state: 'active' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows draft → active → settled with expectedVersion CAS', async () => {
      const stored = {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        opportunityId: null as string | null,
        instrumentKey: 'k',
        routeKey: null as string | null,
        state: 'draft',
        notional: '0',
        summary: {} as Record<string, unknown>,
        entityVersion: 1,
        idempotencyKey: null as string | null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const em = {
        findOne: jest.fn(() => ({ ...stored })),
        save: jest.fn((_Entity: unknown, r: typeof stored) => {
          Object.assign(stored, r);
          return { ...stored };
        }),
      };

      const repo = {
        manager: {
          transaction: async (fn: (e: typeof em) => Promise<unknown>) => fn(em),
        },
      } as never;

      const svc = new PaperTradesService(repo, mkAudit(), mkCapital());

      await svc.patch(stored.id, { expectedVersion: 1, state: 'active' });
      expect(stored.state).toBe('active');
      expect(stored.entityVersion).toBe(2);

      await svc.patch(stored.id, { expectedVersion: 2, state: 'settled' });
      expect(stored.state).toBe('settled');
      expect(stored.entityVersion).toBe(3);
    });

    it('rejects draft → settled (must go through active)', async () => {
      const stored = {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        opportunityId: null as string | null,
        instrumentKey: 'k',
        routeKey: null as string | null,
        state: 'draft',
        notional: '0',
        summary: {} as Record<string, unknown>,
        entityVersion: 1,
        idempotencyKey: null as string | null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const em = {
        findOne: jest.fn(() => ({ ...stored })),
        save: jest.fn(),
      };

      const repo = {
        manager: {
          transaction: async (fn: (e: typeof em) => Promise<unknown>) => fn(em),
        },
      } as never;

      const svc = new PaperTradesService(repo, mkAudit(), mkCapital());

      await expect(
        svc.patch(stored.id, { expectedVersion: 1, state: 'settled' }),
      ).rejects.toThrow(ConflictException);
      expect(em.save).not.toHaveBeenCalled();
    });

    it('patches notional without state transition', async () => {
      const em = mkEm({ id: 'p1', state: 'draft', entityVersion: 1, notional: '0' });
      const svc = new PaperTradesService(mkRepo(em), mkAudit(), mkCapital());
      const out = await svc.patch('p1', { expectedVersion: 1, notional: '100' });
      // Service applies notional then bumps entityVersion.
      expect(em.save).toHaveBeenCalled();
      expect((out as { entityVersion: number }).entityVersion).toBe(2);
    });
  });

  describe('approve / reject / cancel', () => {
    type Row = Partial<PaperTradeEntity>;
    const mkSvc = (
      before: Row | null,
      emRow: Row | null,
      capital?: PaperCapitalService,
    ) => {
      const em = {
        findOne: jest.fn().mockResolvedValue(emRow),
        save: jest.fn((_e: unknown, saved: unknown) =>
          Promise.resolve(saved),
        ),
      };
      const repo = {
        findOne: jest.fn().mockResolvedValue(before),
        manager: {
          transaction: jest.fn(
            (fn: (em: unknown) => Promise<unknown>) => Promise.resolve(fn(em)),
          ),
        },
      } as never;
      return {
        svc: new PaperTradesService(repo, mkAudit(), capital ?? mkCapital()),
        audit: undefined as unknown as AuditClientService,
      };
    };

    it('approve throws NotFoundException when row missing', async () => {
      const { svc } = mkSvc(null, null);
      await expect(svc.approve('p1', 'op-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('approve throws BadRequestException when row is not in draft state', async () => {
      const { svc } = mkSvc(
        { id: 'p1', state: 'active', entityVersion: 1, instrumentKey: 'BTC-USDT', notional: '0' },
        null,
      );
      await expect(svc.approve('p1', 'op-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('approve reserves virtual capital, transitions draft → active, and records audit', async () => {
      const capital = mkCapital();
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const audit = { appendEntry } as unknown as AuditClientService;
      const before: Row = {
        id: 'p1',
        state: 'draft',
        entityVersion: 1,
        instrumentKey: 'BTC-USDT',
        notional: '100',
      };
      const em = {
        findOne: jest.fn().mockResolvedValue({ ...before }),
        save: jest.fn((_e: unknown, saved: unknown) =>
          Promise.resolve({ ...(saved as object), state: 'active' }),
        ),
      };
      const repo = {
        findOne: jest.fn().mockResolvedValue({ ...before }),
        manager: {
          transaction: jest.fn(
            (fn: (em: unknown) => Promise<unknown>) => Promise.resolve(fn(em)),
          ),
        },
      } as never;
      const svc = new PaperTradesService(repo, audit, capital);
      const out = await svc.approve('p1', 'op-1');
      expect(out.state).toBe('active');
      expect(capital.reserveCapital).toHaveBeenCalledWith('BTC-USDT', '100');
      expect(appendEntry).toHaveBeenCalledTimes(1);
      const entry = appendEntry.mock.calls[0]?.[0] as { action: string; actor: string };
      expect(entry.action).toBe('paper_trade_approved');
      expect(entry.actor).toBe('op-1');
    });

    it('reject throws NotFoundException when row missing', async () => {
      const { svc } = mkSvc(null, null);
      await expect(svc.reject('p1', 'op-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('reject throws BadRequestException when row is not in draft state', async () => {
      const { svc } = mkSvc(
        { id: 'p1', state: 'settled', entityVersion: 1 },
        null,
      );
      await expect(svc.reject('p1', 'op-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('reject transitions draft → canceled and records audit', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const audit = { appendEntry } as unknown as AuditClientService;
      const before: Row = {
        id: 'p1',
        state: 'draft',
        entityVersion: 1,
        instrumentKey: 'BTC-USDT',
        notional: '100',
      };
      const em = {
        findOne: jest.fn().mockResolvedValue({ ...before }),
        save: jest.fn((_e: unknown, saved: unknown) =>
          Promise.resolve({ ...(saved as object), state: 'canceled' }),
        ),
      };
      const repo = {
        findOne: jest.fn().mockResolvedValue({ ...before }),
        manager: {
          transaction: jest.fn(
            (fn: (em: unknown) => Promise<unknown>) => Promise.resolve(fn(em)),
          ),
        },
      } as never;
      const svc = new PaperTradesService(repo, audit, mkCapital());
      const out = await svc.reject('p1', 'op-2');
      expect(out.state).toBe('canceled');
      const entry = appendEntry.mock.calls[0]?.[0] as { action: string; actor: string };
      expect(entry.action).toBe('paper_trade_rejected');
      expect(entry.actor).toBe('op-2');
    });

    it('cancel throws NotFoundException when row missing', async () => {
      const { svc } = mkSvc(null, null);
      await expect(svc.cancel('p1', 'op-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('cancel throws BadRequestException when row is not in active state', async () => {
      const { svc } = mkSvc(
        { id: 'p1', state: 'draft', entityVersion: 1 },
        null,
      );
      await expect(svc.cancel('p1', 'op-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('cancel expires active reservation (if any), transitions active → canceled, records audit', async () => {
      const capital = mkCapital();
      (capital.getActiveReservation as jest.Mock).mockResolvedValue({
        id: 'resv-1',
      });
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const audit = { appendEntry } as unknown as AuditClientService;
      const before: Row = {
        id: 'p1',
        state: 'active',
        entityVersion: 1,
        instrumentKey: 'BTC-USDT',
        notional: '100',
      };
      const em = {
        findOne: jest.fn().mockResolvedValue({ ...before }),
        save: jest.fn((_e: unknown, saved: unknown) =>
          Promise.resolve({ ...(saved as object), state: 'canceled' }),
        ),
      };
      const repo = {
        findOne: jest.fn().mockResolvedValue({ ...before }),
        manager: {
          transaction: jest.fn(
            (fn: (em: unknown) => Promise<unknown>) => Promise.resolve(fn(em)),
          ),
        },
      } as never;
      const svc = new PaperTradesService(repo, audit, capital);
      const out = await svc.cancel('p1', 'op-3');
      expect(out.state).toBe('canceled');
      expect(capital.getActiveReservation).toHaveBeenCalledWith('BTC-USDT');
      expect(capital.expireReservation).toHaveBeenCalledWith('resv-1');
      const entry = appendEntry.mock.calls[0]?.[0] as { action: string };
      expect(entry.action).toBe('paper_trade_canceled');
    });

    it('cancel skips expireReservation when no active reservation exists', async () => {
      const capital = mkCapital();
      (capital.getActiveReservation as jest.Mock).mockResolvedValue(null);
      const before: Row = {
        id: 'p1',
        state: 'active',
        entityVersion: 1,
        instrumentKey: 'BTC-USDT',
        notional: '100',
      };
      const em = {
        findOne: jest.fn().mockResolvedValue({ ...before }),
        save: jest.fn((_e: unknown, saved: unknown) =>
          Promise.resolve({ ...(saved as object), state: 'canceled' }),
        ),
      };
      const repo = {
        findOne: jest.fn().mockResolvedValue({ ...before }),
        manager: {
          transaction: jest.fn(
            (fn: (em: unknown) => Promise<unknown>) => Promise.resolve(fn(em)),
          ),
        },
      } as never;
      const svc = new PaperTradesService(repo, mkAudit(), capital);
      await svc.cancel('p1', 'op-4');
      expect(capital.expireReservation).not.toHaveBeenCalled();
    });
  });
});
