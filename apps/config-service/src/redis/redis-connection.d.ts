import { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createRedisClientFromEnv } from '@arbibot/nest-database';
type RedisClient = NonNullable<Awaited<ReturnType<typeof createRedisClientFromEnv>>>;
export declare class RedisConnection implements OnModuleInit, OnModuleDestroy {
    private readonly logger;
    private clientInstance;
    get client(): RedisClient | null;
    onModuleInit(): Promise<void>;
    onModuleDestroy(): Promise<void>;
}
export {};
