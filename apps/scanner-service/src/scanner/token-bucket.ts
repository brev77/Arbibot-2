/**
 * Token-bucket rate limiter (S1-4-RPC).
 *
 * Bounds outbound RPC call rate per chain so the scanner does not trip 429 on free public
 * endpoints (rate limit ~50 req/min on arb1.arbitrum.io / mainnet.base.org — see
 * docs/adr-scanner-service.md §4). Tokens refill continuously at `ratePerSecond` (so the
 * bucket never blocks longer than 1/rate), capped at `capacity` (burst).
 *
 * Design notes:
 *   - Pure, synchronous, no timers: refill is computed lazily on each `tryConsume()` from
 *     wall-clock elapsed time. This keeps the limiter cheap and testable with fake timers.
 *   - Single-chain usage: one bucket per chain (scanner creates one in RpcProviderManager).
 *   - `tryConsume(n)` returns false when fewer than n tokens available; the caller decides
 *     whether to retry, back off, or skip the cycle.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    /** Steady-state allow rate, tokens per second. */
    readonly ratePerSecond: number,
    /** Bucket capacity (max burst). Defaults to ratePerSecond (1s of burst). */
    readonly capacity: number = ratePerSecond,
    /** Inject now() for tests; defaults to Date.now. */
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) {
      throw new Error(`TokenBucket ratePerSecond must be > 0 (got ${ratePerSecond})`);
    }
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error(`TokenBucket capacity must be > 0 (got ${capacity})`);
    }
    this.tokens = capacity;
    this.lastRefillMs = this.now();
  }

  /** Lazily refill tokens based on wall-clock elapsed time since the last consume. */
  private refill(): void {
    const nowMs = this.now();
    const elapsedSec = (nowMs - this.lastRefillMs) / 1000;
    if (elapsedSec <= 0) {
      return;
    }
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.ratePerSecond);
    this.lastRefillMs = nowMs;
  }

  /**
   * Try to consume `cost` tokens. Returns true if allowed (tokens decremented), false if
   * the bucket is too empty (no mutation). Default cost is 1.
   */
  tryConsume(cost = 1): boolean {
    this.refill();
    if (this.tokens < cost) {
      return false;
    }
    this.tokens -= cost;
    return true;
  }

  /** Current available tokens (after a lazy refill). For metrics/health. */
  availableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /** Update the rate at runtime (e.g. on config refresh). Preserves current token count. */
  setRate(ratePerSecond: number, capacity: number = ratePerSecond): void {
    if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) {
      throw new Error(`TokenBucket ratePerSecond must be > 0 (got ${ratePerSecond})`);
    }
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error(`TokenBucket capacity must be > 0 (got ${capacity})`);
    }
    this.refill();
    // `capacity` is read-only on the instance; reassign via a cast for the live-tune path.
    (this as { capacity: number }).capacity = capacity;
    (this as { ratePerSecond: number }).ratePerSecond = ratePerSecond;
    this.tokens = Math.min(this.tokens, capacity);
  }
}
