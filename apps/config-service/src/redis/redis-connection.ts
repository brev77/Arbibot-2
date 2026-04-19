import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createRedisClientFromEnv } from '@arbibot/nest-database';

type RedisClient = NonNullable<Awaited<ReturnType<typeof createRedisClientFromEnv>>>;

@Injectable()
export class RedisConnection implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisConnection.name);
  private clientInstance: RedisClient | null = null;

  get client(): RedisClient | null {
    return this.clientInstance;
  }

  async onModuleInit(): Promise<void> {
    try {
      this.clientInstance = await createRedisClientFromEnv();
      if (this.clientInstance !== null) {
        this.logger.log('Redis connected (config service cache)');
      }
    } catch (err: unknown) {
      this.logger.warn(
        `Redis unavailable; continuing without cache: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.clientInstance = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.clientInstance === null) {
      return;
    }
    try {
      await this.clientInstance.quit();
    } catch (err: unknown) {
      this.logger.warn(
        `Redis quit failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.clientInstance = null;
  }
}
