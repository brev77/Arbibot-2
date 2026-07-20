jest.mock('@arbibot/nest-database', () => ({
  createRedisClientFromEnv: jest.fn(),
}));

import { Logger } from '@nestjs/common';
import { createRedisClientFromEnv } from '@arbibot/nest-database';

import { RedisConnection } from './redis-connection';

const mockedCreate = createRedisClientFromEnv as jest.Mock;

describe('RedisConnection', () => {
  let connection: RedisConnection;

  beforeEach(() => {
    mockedCreate.mockReset();
    // Silence Nest logger output during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    connection = new RedisConnection();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('client getter', () => {
    it('returns null before onModuleInit', () => {
      expect(connection.client).toBeNull();
    });

    it('returns the client instance after successful init', async () => {
      const fakeClient = { quit: jest.fn().mockResolvedValue(undefined) };
      mockedCreate.mockResolvedValue(fakeClient);
      await connection.onModuleInit();
      expect(connection.client).toBe(fakeClient);
      await connection.onModuleDestroy();
    });
  });

  describe('onModuleInit', () => {
    it('logs "Redis connected" when createRedisClientFromEnv returns a client', async () => {
      const fakeClient = { quit: jest.fn().mockResolvedValue(undefined) };
      mockedCreate.mockResolvedValue(fakeClient);
      const logSpy = jest.spyOn(Logger.prototype, 'log');
      await connection.onModuleInit();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Redis connected'),
      );
      await connection.onModuleDestroy();
    });

    it('keeps client null when createRedisClientFromEnv resolves null', async () => {
      mockedCreate.mockResolvedValue(null);
      await connection.onModuleInit();
      expect(connection.client).toBeNull();
    });

    it('warns and sets client null when createRedisClientFromEnv throws Error', async () => {
      mockedCreate.mockRejectedValue(new Error('connection refused'));
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');
      await connection.onModuleInit();
      expect(connection.client).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('connection refused'),
      );
    });

    it('warns and sets client null when createRedisClientFromEnv throws non-Error', async () => {
      mockedCreate.mockRejectedValue('netfail');
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');
      await connection.onModuleInit();
      expect(connection.client).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('netfail'),
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('quits the client when present', async () => {
      const quit = jest.fn().mockResolvedValue(undefined);
      mockedCreate.mockResolvedValue({ quit });
      await connection.onModuleInit();
      await connection.onModuleDestroy();
      expect(quit).toHaveBeenCalled();
      expect(connection.client).toBeNull();
    });

    it('warns but still clears client when quit rejects', async () => {
      const quit = jest.fn().mockRejectedValue(new Error('quit failed'));
      mockedCreate.mockResolvedValue({ quit });
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');
      await connection.onModuleInit();
      await connection.onModuleDestroy();
      expect(quit).toHaveBeenCalled();
      expect(connection.client).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('quit failed'),
      );
    });

    it('warns on non-Error quit rejection', async () => {
      const quit = jest.fn().mockRejectedValue('strfail');
      mockedCreate.mockResolvedValue({ quit });
      const warnSpy = jest.spyOn(Logger.prototype, 'warn');
      await connection.onModuleInit();
      await connection.onModuleDestroy();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('strfail'),
      );
    });

    it('is a no-op when client was never initialised', async () => {
      // No init; clientInstance === null
      await expect(connection.onModuleDestroy()).resolves.toBeUndefined();
      expect(connection.client).toBeNull();
    });

    it('is a no-op after destroy is called twice', async () => {
      const quit = jest.fn().mockResolvedValue(undefined);
      mockedCreate.mockResolvedValue({ quit });
      await connection.onModuleInit();
      await connection.onModuleDestroy();
      // Second destroy should be a no-op
      await expect(connection.onModuleDestroy()).resolves.toBeUndefined();
      expect(quit).toHaveBeenCalledTimes(1);
    });
  });
});
