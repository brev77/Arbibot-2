// createRedisClientFromEnv is the factory under test; mock it at the module
// boundary so no real Redis connection is attempted.
jest.mock('@arbibot/nest-database', () => {
  const actual = jest.requireActual('@arbibot/nest-database');
  return {
    ...actual,
    createRedisClientFromEnv: jest.fn(),
  };
});

import { createRedisClientFromEnv } from '@arbibot/nest-database';

import { RedisConnection } from './redis-connection';

const mockFactory = createRedisClientFromEnv as unknown as jest.Mock;

describe('RedisConnection', () => {
  let connection: RedisConnection;

  beforeEach(() => {
    mockFactory.mockReset();
    connection = new RedisConnection();
  });

  describe('client getter', () => {
    it('returns null before onModuleInit runs', () => {
      expect(connection.client).toBeNull();
    });
  });

  describe('onModuleInit', () => {
    it('stores the client when the factory returns one', async () => {
      const client = { quit: jest.fn().mockResolvedValue(undefined) };
      mockFactory.mockResolvedValue(client);

      await connection.onModuleInit();

      expect(connection.client).toBe(client);
      expect(mockFactory).toHaveBeenCalledTimes(1);
    });

    it('keeps client null when the factory returns null (Redis disabled)', async () => {
      mockFactory.mockResolvedValue(null);

      await connection.onModuleInit();

      expect(connection.client).toBeNull();
    });

    it('swallows factory errors and sets client to null (graceful degradation)', async () => {
      mockFactory.mockRejectedValue(new Error('ECONNREFUSED'));

      await connection.onModuleInit();

      // Cache is best-effort; the service must keep starting up without Redis.
      expect(connection.client).toBeNull();
    });

    it('handles non-Error rejections in the factory (String(err) fallback)', async () => {
      mockFactory.mockRejectedValue('string-thrown');

      await connection.onModuleInit();

      expect(connection.client).toBeNull();
    });
  });

  describe('onModuleDestroy', () => {
    it('is a no-op when there is no client (never connected / failed init)', async () => {
      await connection.onModuleDestroy();
      expect(connection.client).toBeNull();
    });

    it('calls quit() on the connected client and clears the reference', async () => {
      const quit = jest.fn().mockResolvedValue(undefined);
      mockFactory.mockResolvedValue({ quit });
      await connection.onModuleInit();

      await connection.onModuleDestroy();

      expect(quit).toHaveBeenCalledTimes(1);
      expect(connection.client).toBeNull();
    });

    it('clears the client reference even if quit() throws', async () => {
      const quit = jest.fn().mockRejectedValue(new Error('quit-failed'));
      mockFactory.mockResolvedValue({ quit });
      await connection.onModuleInit();

      await connection.onModuleDestroy();

      // Reference must be released regardless of the quit failure.
      expect(connection.client).toBeNull();
    });

    it('handles non-Error quit() rejections (String(err) fallback)', async () => {
      const quit = jest.fn().mockRejectedValue('string-thrown');
      mockFactory.mockResolvedValue({ quit });
      await connection.onModuleInit();

      await connection.onModuleDestroy();

      expect(connection.client).toBeNull();
    });
  });
});
