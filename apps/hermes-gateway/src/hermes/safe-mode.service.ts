import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { getSafeModeRedisErrorsCounter } from './safe-mode-metrics';

export type SafeModeState = {
  readonly enabled: boolean;
  readonly updatedAt: string;
  readonly reason: string | null;
  readonly updatedByOperatorId: string | null;
};

const REDIS_KEY = 'arbibot:hermes:safe-mode:v1';

function emptyState(): SafeModeState {
  return {
    enabled: false,
    updatedAt: new Date(0).toISOString(),
    reason: null,
    updatedByOperatorId: null,
  };
}

/**
 * Safe mode: Redis when `HERMES_SAFE_MODE_REDIS_URL` or `REDIS_URL` is set
 * (unless `HERMES_SAFE_MODE_USE_MEMORY_ONLY=true`). Otherwise in-process only.
 */
@Injectable()
export class SafeModeService implements OnModuleDestroy {
  private readonly log = new Logger(SafeModeService.name);
  private readonly redis: Redis | null;
  private enabled = false;
  private updatedAt = new Date(0).toISOString();
  private reason: string | null = null;
  private updatedByOperatorId: string | null = null;

  constructor() {
    const memoryOnly = process.env.HERMES_SAFE_MODE_USE_MEMORY_ONLY === 'true';
    const url = (
      process.env.HERMES_SAFE_MODE_REDIS_URL ?? process.env.REDIS_URL ?? ''
    ).trim();
    if (!memoryOnly && url.length > 0) {
      this.redis = new Redis(url, {
        maxRetriesPerRequest: 2,
        lazyConnect: true,
      });
      this.redis.on('error', (err: Error) => {
        this.log.warn(`Redis safe-mode: ${err.message}`);
        try {
          getSafeModeRedisErrorsCounter().inc({ operation: 'connection' });
        } catch {
          /* metrics optional */
        }
      });
    } else {
      this.redis = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis !== null) {
      await this.redis.quit();
    }
  }

  private ttlSeconds(): number {
    const raw = process.env.HERMES_SAFE_MODE_REDIS_TTL_SECONDS?.trim();
    if (raw === undefined || raw.length === 0) {
      return 0;
    }
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 86400 * 7) : 0;
  }

  async getState(): Promise<SafeModeState> {
    if (this.redis === null) {
      return {
        enabled: this.enabled,
        updatedAt: this.updatedAt,
        reason: this.reason,
        updatedByOperatorId: this.updatedByOperatorId,
      };
    }
    try {
      const raw = await this.redis.get(REDIS_KEY);
      if (raw === null || raw.length === 0) {
        return emptyState();
      }
      const parsed = JSON.parse(raw) as Partial<SafeModeState>;
      let reason: string | null = null;
      if (typeof parsed.reason === 'string') {
        reason = parsed.reason;
      } else if (parsed.reason === null) {
        reason = null;
      }
      let updatedByOperatorId: string | null = null;
      if (typeof parsed.updatedByOperatorId === 'string') {
        updatedByOperatorId = parsed.updatedByOperatorId;
      } else if (parsed.updatedByOperatorId === null) {
        updatedByOperatorId = null;
      }
      return {
        enabled: Boolean(parsed.enabled),
        updatedAt:
          typeof parsed.updatedAt === 'string'
            ? parsed.updatedAt
            : emptyState().updatedAt,
        reason,
        updatedByOperatorId,
      };
    } catch (err: unknown) {
      this.log.warn(
        `getState redis read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      try {
        getSafeModeRedisErrorsCounter().inc({ operation: 'get' });
      } catch {
        /* metrics optional */
      }
      return emptyState();
    }
  }

  async enable(operatorId: string, reason?: string): Promise<SafeModeState> {
    const state: SafeModeState = {
      enabled: true,
      updatedAt: new Date().toISOString(),
      reason: reason ?? 'operator_enabled',
      updatedByOperatorId: operatorId,
    };
    if (this.redis === null) {
      this.enabled = true;
      this.updatedAt = state.updatedAt;
      this.reason = state.reason;
      this.updatedByOperatorId = operatorId;
      return state;
    }
    const ttl = this.ttlSeconds();
    const payload = JSON.stringify(state);
    try {
      if (ttl > 0) {
        await this.redis.set(REDIS_KEY, payload, 'EX', ttl);
      } else {
        await this.redis.set(REDIS_KEY, payload);
      }
    } catch (err: unknown) {
      this.log.warn(
        `enable redis write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      try {
        getSafeModeRedisErrorsCounter().inc({ operation: 'set' });
      } catch {
        /* metrics optional */
      }
      throw err;
    }
    return state;
  }

  async disable(operatorId: string, reason?: string): Promise<SafeModeState> {
    const state: SafeModeState = {
      enabled: false,
      updatedAt: new Date().toISOString(),
      reason: reason ?? 'operator_disabled',
      updatedByOperatorId: operatorId,
    };
    if (this.redis === null) {
      this.enabled = false;
      this.updatedAt = state.updatedAt;
      this.reason = state.reason;
      this.updatedByOperatorId = operatorId;
      return state;
    }
    const ttl = this.ttlSeconds();
    const payload = JSON.stringify(state);
    try {
      if (ttl > 0) {
        await this.redis.set(REDIS_KEY, payload, 'EX', ttl);
      } else {
        await this.redis.set(REDIS_KEY, payload);
      }
    } catch (err: unknown) {
      this.log.warn(
        `disable redis write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      try {
        getSafeModeRedisErrorsCounter().inc({ operation: 'set' });
      } catch {
        /* metrics optional */
      }
      throw err;
    }
    return state;
  }
}
