import { ConflictException } from '@nestjs/common';

import { PaperTradesService } from './paper-trades.service';

describe('PaperTradesService', () => {
  it('builds with mocked repository', () => {
    const repo = {} as never;
    const svc = new PaperTradesService(repo);
    expect(svc).toBeDefined();
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

    const svc = new PaperTradesService(repo);

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

    const svc = new PaperTradesService(repo);

    await expect(
      svc.patch(stored.id, { expectedVersion: 1, state: 'settled' }),
    ).rejects.toThrow(ConflictException);
    expect(em.save).not.toHaveBeenCalled();
  });
});
