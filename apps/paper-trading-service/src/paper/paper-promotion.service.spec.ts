import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { AuditClientService } from '@arbibot/nest-platform';
import { PaperPromotionCandidateEntity } from '@arbibot/persistence';

import { PaperPromotionService, promotionQualityFor } from './paper-promotion.service';

const auditMock = {
  appendEntry: jest.fn().mockResolvedValue(undefined),
} as unknown as AuditClientService;

describe('PaperPromotionService', () => {
  const prevMaxDrift = process.env.PAPER_PROMOTION_MAX_DRIFT_BPS;
  const prevMinScore = process.env.PAPER_PROMOTION_MIN_SCORE;

  afterEach(() => {
    if (prevMaxDrift === undefined) {
      delete process.env.PAPER_PROMOTION_MAX_DRIFT_BPS;
    } else {
      process.env.PAPER_PROMOTION_MAX_DRIFT_BPS = prevMaxDrift;
    }
    if (prevMinScore === undefined) {
      delete process.env.PAPER_PROMOTION_MIN_SCORE;
    } else {
      process.env.PAPER_PROMOTION_MIN_SCORE = prevMinScore;
    }
  });

  it('builds with mocked repository', () => {
    const repo = {} as never;
    const svc = new PaperPromotionService(repo, auditMock);
    expect(svc).toBeDefined();
  });

  it('returns existing row when enqueueIdempotencyKey matches', async () => {
    const existing = {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      instrumentKey: 'x',
      opportunityId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      source: 'opportunity_hook',
      status: 'queued' as const,
      score: null,
      driftBps: null,
      evidence: {},
      entityVersion: 1,
      enqueueIdempotencyKey: 'idem-1',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const repo = {
      findOne: jest.fn((opts: { where: { enqueueIdempotencyKey: string } }) => {
        if (opts.where.enqueueIdempotencyKey === 'idem-1') {
          return { ...existing };
        }
        return null;
      }),
      create: jest.fn(),
      save: jest.fn(),
    } as never;

    const svc = new PaperPromotionService(repo, auditMock);
    const row = await svc.create({
      instrumentKey: 'x',
      opportunityId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      source: 'opportunity_hook',
      enqueueIdempotencyKey: 'idem-1',
      evidence: {},
    });

    expect(row.id).toBe(existing.id);
    expect((repo as { save: jest.Mock }).save).not.toHaveBeenCalled();
  });

  it('replays on unique violation after concurrent insert', async () => {
    const savedRow = {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      instrumentKey: 'y',
      opportunityId: null,
      source: 'paper_discovery',
      status: 'queued' as const,
      score: null,
      driftBps: null,
      evidence: {},
      entityVersion: 1,
      enqueueIdempotencyKey: 'idem-2',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    let saveAttempted = false;
    const repo = {
      findOne: jest.fn((opts: { where: { enqueueIdempotencyKey?: string } }) => {
        if (opts.where.enqueueIdempotencyKey !== 'idem-2') {
          return null;
        }
        if (saveAttempted) {
          return { ...savedRow };
        }
        return null;
      }),
      create: jest.fn((_partial: unknown) => ({ ...savedRow })),
      save: jest.fn(() => {
        saveAttempted = true;
        throw new QueryFailedError(
          'INSERT',
          [],
          Object.assign(new Error('duplicate'), { code: '23505' }),
        );
      }),
    } as never;

    const svc = new PaperPromotionService(repo, auditMock);
    const row = await svc.create({
      instrumentKey: 'y',
      enqueueIdempotencyKey: 'idem-2',
      evidence: {},
    });

    expect(row.id).toBe(savedRow.id);
  });

  describe('list', () => {
    it('throws BadRequestException when status filter is not in PAPER_PROMOTION_STATUSES', async () => {
      const repo = { find: jest.fn() } as never;
      const svc = new PaperPromotionService(repo, auditMock);
      await expect(svc.list('bogus')).rejects.toBeInstanceOf(BadRequestException);
      expect((repo as { find: jest.Mock }).find).not.toHaveBeenCalled();
    });

    it('forwards status filter to repo.find when valid', async () => {
      const find = jest.fn().mockResolvedValue([]);
      const repo = { find } as never;
      const svc = new PaperPromotionService(repo, auditMock);
      await svc.list('queued');
      expect(find.mock.calls[0]?.[0]).toMatchObject({
        where: { status: 'queued' },
        order: { updatedAt: 'DESC' },
        take: 200,
      });
    });

    it('returns unfiltered DESC list when status omitted', async () => {
      const find = jest.fn().mockResolvedValue([]);
      const repo = { find } as never;
      const svc = new PaperPromotionService(repo, auditMock);
      await svc.list(undefined);
      expect(find.mock.calls[0]?.[0]?.where).toEqual({});
    });

    it('returns unfiltered list when status is empty string', async () => {
      const find = jest.fn().mockResolvedValue([]);
      const repo = { find } as never;
      const svc = new PaperPromotionService(repo, auditMock);
      await svc.list('');
      expect(find.mock.calls[0]?.[0]?.where).toEqual({});
    });
  });

  describe('create (no idempotency key / numeric fields)', () => {
    it('persists a row without idempotency key (no findOne lookup)', async () => {
      const created = { id: 'p1', status: 'queued' };
      const repo = {
        findOne: jest.fn(),
        create: jest.fn((partial) => ({ ...partial, ...created })),
        save: jest.fn((row) => Promise.resolve(row)),
      } as never;
      const svc = new PaperPromotionService(repo, auditMock);
      const row = await svc.create({
        instrumentKey: 'BTC-USDT',
        score: 8.5,
        driftBps: -3,
      });
      expect(row.instrumentKey).toBe('BTC-USDT');
      const created0 = (repo as { create: jest.Mock }).create.mock.calls[0]?.[0];
      expect(created0.score).toBe('8.5');
      expect(created0.driftBps).toBe('-3');
      expect(created0.enqueueIdempotencyKey).toBeNull();
      // No findOne lookup when idempotencyKey is absent.
      expect((repo as { findOne: jest.Mock }).findOne).not.toHaveBeenCalled();
    });

    it('coerces NaN score/driftBps to null when numeric NaN is passed', async () => {
      const repo = {
        findOne: jest.fn(),
        create: jest.fn((partial) => partial),
        save: jest.fn((row) => Promise.resolve(row)),
      } as never;
      const svc = new PaperPromotionService(repo, auditMock);
      await svc.create({
        instrumentKey: 'BTC-USDT',
        score: NaN,
        driftBps: NaN,
      });
      const created0 = (repo as { create: jest.Mock }).create.mock.calls[0]?.[0];
      expect(created0.score).toBeNull();
      expect(created0.driftBps).toBeNull();
    });

    it('rethrows non-unique-violation errors on save', async () => {
      const repo = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn((p) => p),
        save: jest.fn(() => {
          throw new Error('connection refused');
        }),
      } as never;
      const svc = new PaperPromotionService(repo, auditMock);
      await expect(
        svc.create({ instrumentKey: 'BTC-USDT', enqueueIdempotencyKey: 'idem-x' }),
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
      const svc = new PaperPromotionService(repo, auditMock);
      await expect(
        svc.create({ instrumentKey: 'BTC-USDT', enqueueIdempotencyKey: 'idem-y' }),
      ).rejects.toBeInstanceOf(QueryFailedError);
    });
  });

  describe('patch (transaction + state machine)', () => {
    type Em = {
      findOne: jest.Mock;
      save: jest.Mock;
    };
    const mkEm = (row: Partial<PaperPromotionCandidateEntity> | null): Em => ({
      findOne: jest.fn().mockResolvedValue(row),
      save: jest.fn((entity, saved) => Promise.resolve(saved ?? entity)),
    });

    it('throws NotFoundException when row does not exist', async () => {
      const em = mkEm(null);
      const repo = {
        manager: { transaction: jest.fn((fn: (em: unknown) => Promise<unknown>) => Promise.resolve(fn(em))) },
      } as never;
      const svc = new PaperPromotionService(repo, auditMock);
      await expect(
        svc.patch('p1', { expectedVersion: 1, status: 'under_review' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException on entityVersion mismatch', async () => {
      const em = mkEm({ id: 'p1', status: 'queued', entityVersion: 5 });
      const repo = {
        manager: { transaction: jest.fn((fn: (em: unknown) => Promise<unknown>) => Promise.resolve(fn(em))) },
      } as never;
      const svc = new PaperPromotionService(repo, auditMock);
      await expect(
        svc.patch('p1', { expectedVersion: 1, status: 'under_review' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException on invalid transition (promoted → queued)', async () => {
      const em = mkEm({ id: 'p1', status: 'promoted', entityVersion: 1 });
      const repo = {
        manager: { transaction: jest.fn((fn: (em: unknown) => Promise<unknown>) => Promise.resolve(fn(em))) },
      } as never;
      const svc = new PaperPromotionService(repo, auditMock);
      await expect(
        svc.patch('p1', { expectedVersion: 1, status: 'queued' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('applies the transition and bumps entityVersion on valid patch', async () => {
      const em = mkEm({ id: 'p1', status: 'queued', entityVersion: 1 });
      const repo = {
        manager: { transaction: jest.fn((fn: (em: unknown) => Promise<unknown>) => Promise.resolve(fn(em))) },
      } as never;
      const svc = new PaperPromotionService(repo, auditMock);
      const out = await svc.patch('p1', {
        expectedVersion: 1,
        status: 'under_review',
      });
      expect(out.status).toBe('under_review');
      expect(out.entityVersion).toBe(2);
    });
  });

  describe('getPromotionCriteria', () => {
    it('returns defaults when env unset', () => {
      delete process.env.PAPER_PROMOTION_MAX_DRIFT_BPS;
      delete process.env.PAPER_PROMOTION_MIN_SCORE;
      const svc = new PaperPromotionService({} as never, auditMock);
      const crit = svc.getPromotionCriteria();
      expect(crit.maxDriftBps).toBe(50);
      expect(crit.minScore).toBeNull();
    });

    it('falls back to 50 when PAPER_PROMOTION_MAX_DRIFT_BPS is non-finite', () => {
      process.env.PAPER_PROMOTION_MAX_DRIFT_BPS = 'NaN';
      const svc = new PaperPromotionService({} as never, auditMock);
      expect(svc.getPromotionCriteria().maxDriftBps).toBe(50);
    });

    it('parses PAPER_PROMOTION_MIN_SCORE when set to a number', () => {
      process.env.PAPER_PROMOTION_MIN_SCORE = '6.5';
      const svc = new PaperPromotionService({} as never, auditMock);
      expect(svc.getPromotionCriteria().minScore).toBe(6.5);
    });

    it('returns null minScore when PAPER_PROMOTION_MIN_SCORE is whitespace', () => {
      process.env.PAPER_PROMOTION_MIN_SCORE = '   ';
      const svc = new PaperPromotionService({} as never, auditMock);
      expect(svc.getPromotionCriteria().minScore).toBeNull();
    });
  });

  describe('evaluatePromotionEligibility', () => {
    it('returns ok=true when drift within max and no minScore', () => {
      const svc = new PaperPromotionService({} as never, auditMock);
      const res = svc.evaluatePromotionEligibility({ driftBps: '30', score: null });
      expect(res.ok).toBe(true);
      expect(res.reasons).toEqual([]);
    });

    it('returns drift reason when driftBps exceeds max', () => {
      const svc = new PaperPromotionService({} as never, auditMock);
      const res = svc.evaluatePromotionEligibility({ driftBps: '75', score: null });
      expect(res.ok).toBe(false);
      expect(res.reasons[0]).toContain('drift_bps');
    });

    it('returns no drift reason when driftBps is null', () => {
      const svc = new PaperPromotionService({} as never, auditMock);
      const res = svc.evaluatePromotionEligibility({ driftBps: null, score: null });
      expect(res.ok).toBe(true);
    });

    it('returns score reason when score below minScore', () => {
      process.env.PAPER_PROMOTION_MIN_SCORE = '7';
      const svc = new PaperPromotionService({} as never, auditMock);
      const res = svc.evaluatePromotionEligibility({ driftBps: null, score: '5' });
      expect(res.ok).toBe(false);
      expect(res.reasons[0]).toContain('score below minimum');
    });

    it('returns score reason when score is NaN with minScore set', () => {
      process.env.PAPER_PROMOTION_MIN_SCORE = '7';
      const svc = new PaperPromotionService({} as never, auditMock);
      const res = svc.evaluatePromotionEligibility({ driftBps: null, score: null });
      expect(res.ok).toBe(false);
    });
  });

  describe('approve / reject', () => {
    type Row = Partial<PaperPromotionCandidateEntity>;
    const mkSvc = (findOneResult: Row | null, emRow: Row | null) => {
      const em = {
        findOne: jest.fn().mockResolvedValue(emRow),
        save: jest.fn((_e: unknown, saved: unknown) => Promise.resolve(saved)),
      };
      const repo = {
        findOne: jest.fn().mockResolvedValue(findOneResult),
        manager: { transaction: jest.fn(async (fn: (em: unknown) => Promise<unknown>) => fn(em)) },
      } as never;
      return { svc: new PaperPromotionService(repo, auditMock), repo };
    };

    it('approve throws NotFoundException when row missing', async () => {
      const { svc } = mkSvc(null, null);
      await expect(svc.approve('p1', 'op-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('approve throws BadRequestException when row is already promoted', async () => {
      const { svc } = mkSvc({ id: 'p1', status: 'promoted', entityVersion: 1 }, null);
      await expect(svc.approve('p1', 'op-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('approve throws BadRequestException when eligibility fails (drift too high)', async () => {
      const { svc } = mkSvc(
        { id: 'p1', status: 'queued', entityVersion: 1, driftBps: '75', score: '8' },
        null,
      );
      await expect(svc.approve('p1', 'op-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('approve transitions under_review → promoted and records audit', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const audit = { appendEntry } as unknown as AuditClientService;
      const em = {
        findOne: jest.fn().mockResolvedValue({
          id: 'p1',
          status: 'under_review',
          entityVersion: 1,
          instrumentKey: 'BTC-USDT',
          opportunityId: null,
          score: '8',
          driftBps: '10',
        }),
        save: jest.fn((_e: unknown, saved: unknown) => Promise.resolve({
          ...(saved as object),
          status: 'promoted',
          entityVersion: 2,
        })),
      };
      const repo = {
        findOne: jest.fn().mockResolvedValue({
          id: 'p1',
          status: 'under_review',
          entityVersion: 1,
          instrumentKey: 'BTC-USDT',
          opportunityId: null,
          score: '8',
          driftBps: '10',
        }),
        manager: { transaction: jest.fn(async (fn: (em: unknown) => Promise<unknown>) => fn(em)) },
      } as never;
      const svc = new PaperPromotionService(repo, audit);
      const out = await svc.approve('p1', 'op-1');
      expect(out.status).toBe('promoted');
      expect(appendEntry).toHaveBeenCalledTimes(1);
      const entry = appendEntry.mock.calls[0]?.[0] as { action: string; actor: string };
      expect(entry.action).toBe('paper_promotion_candidate_approved');
      expect(entry.actor).toBe('op-1');
    });

    it('reject throws NotFoundException when row missing', async () => {
      const { svc } = mkSvc(null, null);
      await expect(svc.reject('p1', 'op-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reject throws BadRequestException when row is already rejected', async () => {
      const { svc } = mkSvc({ id: 'p1', status: 'rejected', entityVersion: 1 }, null);
      await expect(svc.reject('p1', 'op-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('reject transitions queued → rejected and records audit', async () => {
      const appendEntry = jest.fn().mockResolvedValue(undefined);
      const audit = { appendEntry } as unknown as AuditClientService;
      const em = {
        findOne: jest.fn().mockResolvedValue({
          id: 'p1',
          status: 'queued',
          entityVersion: 1,
        }),
        save: jest.fn((_e: unknown, saved: unknown) => Promise.resolve({
          ...(saved as object),
          status: 'rejected',
          entityVersion: 2,
        })),
      };
      const repo = {
        findOne: jest.fn().mockResolvedValue({
          id: 'p1',
          status: 'queued',
          entityVersion: 1,
          instrumentKey: 'BTC-USDT',
          opportunityId: null,
        }),
        manager: { transaction: jest.fn(async (fn: (em: unknown) => Promise<unknown>) => fn(em)) },
      } as never;
      const svc = new PaperPromotionService(repo, audit);
      const out = await svc.reject('p1', 'op-2');
      expect(out.status).toBe('rejected');
      const entry = appendEntry.mock.calls[0]?.[0] as { action: string; actor: string };
      expect(entry.action).toBe('paper_promotion_candidate_rejected');
      expect(entry.actor).toBe('op-2');
    });
  });

  describe('refreshPersistedQualitySnapshots', () => {
    it('updates quality columns for queued/under_review rows and returns count', async () => {
      const rows = [
        {
          id: 'p1',
          status: 'queued',
          score: '8',
          driftBps: '5',
        },
        {
          id: 'p2',
          status: 'under_review',
          score: null,
          driftBps: null,
        },
      ];
      const update = jest.fn().mockResolvedValue({ affected: 1 });
      const repo = {
        find: jest.fn().mockResolvedValue(rows),
        update,
      } as never;
      const svc = new PaperPromotionService(repo, auditMock);
      const n = await svc.refreshPersistedQualitySnapshots();
      expect(n).toBe(2);
      expect(update).toHaveBeenCalledTimes(2);
      // First row: score 8 + drift 5 → 8 + 2 - 0.05 = 9.95 (high tier)
      const first = update.mock.calls[0]?.[1] as { qualityScore: string; qualityTier: string };
      expect(first.qualityTier).toBe('high');
    });

    it('returns 0 when no queued/under_review rows exist', async () => {
      const repo = {
        find: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      } as never;
      const svc = new PaperPromotionService(repo, auditMock);
      const n = await svc.refreshPersistedQualitySnapshots();
      expect(n).toBe(0);
      expect((repo as { update: jest.Mock }).update).not.toHaveBeenCalled();
    });
  });

  describe('promotionQualityFor (pure helper)', () => {
    it('classifies as high tier when score ≥ 7 after drift penalty', () => {
      const res = promotionQualityFor({
        score: '8',
        driftBps: '10',
      } as PaperPromotionCandidateEntity);
      expect(res.tier).toBe('high');
    });

    it('classifies as medium tier when score + drift-penalty lands in [4, 7)', () => {
      // rawScore 4, drift 0 → 4 + 2 - 0 = 6 → medium (≥4, <7)
      const res = promotionQualityFor({
        score: '4',
        driftBps: '0',
      } as PaperPromotionCandidateEntity);
      expect(res.tier).toBe('medium');
    });

    it('classifies as low tier when score + drift-penalty < 4', () => {
      // rawScore 1, drift 0 → 1 + 2 - 0 = 3 → low (<4)
      const res = promotionQualityFor({
        score: '1',
        driftBps: '0',
      } as PaperPromotionCandidateEntity);
      expect(res.tier).toBe('low');
    });

    it('uses absolute driftBps for penalty (negative drift treated like positive)', () => {
      const res = promotionQualityFor({
        score: '10',
        driftBps: '-300',
      } as PaperPromotionCandidateEntity);
      // drift 300 → penalty min(300/100, 2) = 2 → score 10 + 2 - 2 = 10
      expect(res.tier).toBe('high');
      expect(res.score).toBe(10);
    });

    it('treats null score as 0 (low tier)', () => {
      const res = promotionQualityFor({
        score: null,
        driftBps: null,
      } as PaperPromotionCandidateEntity);
      // rawScore 0, drift 0 → score 0 + 2 - 0 = 2 → low
      expect(res.tier).toBe('low');
    });

    it('clamps final score to [0, 10]', () => {
      // Heavy negative drift would push below 0 → clamped to 0.
      const res = promotionQualityFor({
        score: '0',
        driftBps: '1000',
      } as PaperPromotionCandidateEntity);
      expect(res.score).toBeGreaterThanOrEqual(0);
      expect(res.score).toBeLessThanOrEqual(10);
    });
  });
});
