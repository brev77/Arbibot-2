import { QueryFailedError } from 'typeorm';

import { PaperPromotionService } from './paper-promotion.service';

describe('PaperPromotionService', () => {
  it('builds with mocked repository', () => {
    const repo = {} as never;
    const svc = new PaperPromotionService(repo);
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

    const svc = new PaperPromotionService(repo);
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

    const svc = new PaperPromotionService(repo);
    const row = await svc.create({
      instrumentKey: 'y',
      enqueueIdempotencyKey: 'idem-2',
      evidence: {},
    });

    expect(row.id).toBe(savedRow.id);
  });
});
