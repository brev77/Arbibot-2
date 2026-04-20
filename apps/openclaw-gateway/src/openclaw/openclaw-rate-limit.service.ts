import { Injectable, Logger } from '@nestjs/common';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX = 60;

/**
 * Fixed-window rate limit per API key for mutation endpoints.
 */
@Injectable()
export class OpenclawRateLimitService {
  private readonly log = new Logger(OpenclawRateLimitService.name);
  private readonly buckets = new Map<
    string,
    { count: number; windowStart: number }
  >();

  private windowMs(): number {
    const raw = process.env.OPENCLAW_MUTATION_RATE_LIMIT_WINDOW_MS;
    if (raw === undefined || raw.trim().length === 0) {
      return DEFAULT_WINDOW_MS;
    }
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 3_600_000) : DEFAULT_WINDOW_MS;
  }

  private maxPerWindow(): number {
    const raw = process.env.OPENCLAW_MUTATION_RATE_LIMIT_MAX;
    if (raw === undefined || raw.trim().length === 0) {
      return DEFAULT_MAX;
    }
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : DEFAULT_MAX;
  }

  /** Returns false if limit exceeded. */
  allow(apiKey: string): boolean {
    if (process.env.OPENCLAW_MUTATION_RATE_LIMIT_ENABLED === 'false') {
      return true;
    }
    const now = Date.now();
    const win = this.windowMs();
    const max = this.maxPerWindow();
    let b = this.buckets.get(apiKey);
    if (b === undefined || now - b.windowStart >= win) {
      b = { count: 1, windowStart: now };
      this.buckets.set(apiKey, b);
      return true;
    }
    if (b.count >= max) {
      this.log.warn(`OpenClaw mutation rate limit exceeded for key hash`);
      return false;
    }
    b.count += 1;
    return true;
  }
}
