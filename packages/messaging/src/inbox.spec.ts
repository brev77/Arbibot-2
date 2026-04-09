import { QueryFailedError } from 'typeorm';

import { tryClaimInboxMessage } from './inbox';

describe('tryClaimInboxMessage', () => {
  it('returns true when insert succeeds', async () => {
    const em = {
      create: jest.fn((_Entity: unknown, row: object) => ({ ...row })),
      save: jest.fn(async () => undefined),
    };

    await expect(
      tryClaimInboxMessage(
        em as never,
        'risk-consumer',
        '11111111-1111-4111-8111-111111111111',
      ),
    ).resolves.toBe(true);
  });

  it('returns false on postgres unique violation wrapped by TypeORM', async () => {
    const em = {
      create: jest.fn((_Entity: unknown, row: object) => ({ ...row })),
      save: jest.fn(async () => {
        const driverError = Object.assign(new Error('duplicate key'), {
          code: '23505',
        });
        throw new QueryFailedError(
          'INSERT INTO inbox_events ...',
          [],
          driverError,
        );
      }),
    };

    await expect(
      tryClaimInboxMessage(
        em as never,
        'risk-consumer',
        '22222222-2222-4222-8222-222222222222',
      ),
    ).resolves.toBe(false);
  });

  it('rethrows non-unique failures', async () => {
    const em = {
      create: jest.fn((_Entity: unknown, row: object) => ({ ...row })),
      save: jest.fn(async () => {
        throw new Error('db offline');
      }),
    };

    await expect(
      tryClaimInboxMessage(
        em as never,
        'risk-consumer',
        '33333333-3333-4333-8333-333333333333',
      ),
    ).rejects.toThrow('db offline');
  });
});
