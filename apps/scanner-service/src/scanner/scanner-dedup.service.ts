import { Injectable, Logger } from '@nestjs/common';

import { DEFAULT_SCANNER_DEDUP_COOLDOWN_MS } from './scanner-config.constants';
import type { CrossVenueSpread } from './scanner-spread.service';

/**
 * Dedup cooldown (S2-3-DEDUP).
 *
 * Prevents re-emitting the SAME cross-venue spread within a configurable cooldown window
 * (default 60s, env `SCANNER_DEDUP_COOLDOWN_MS` / `scanner.defaults.dedupCooldownMs`). Keyed by
 * `(canonical_token, buy_venue, sell_venue)` — a spread is a duplicate only if all three match a
 * recently-emitted one. After the cooldown elapses the key is eligible again.
 *
 * Pure in-memory Map of last-emit timestamps; resets on restart (acceptable for a detector whose
 * findings are retained in `scanner_findings`). The Phase 3 publisher is the durable de-dup
 * boundary (idempotency on opportunity-service); this is an in-process rate shield to avoid
 * flooding findings on a persistent spread.
 */
@Injectable()
export class ScannerDedupService {
  private readonly logger = new Logger(ScannerDedupService.name);
  private readonly lastEmittedAt = new Map<string, number>();

  /**
   * Returns true if the spread may be emitted (no recent duplicate), false if it is within the
   * cooldown window of a prior emission. On `true`, records the emission timestamp.
   *
   * @param cooldownMs override the default cooldown (caller passes the resolved config value)
   */
  shouldEmit(spread: CrossVenueSpread, cooldownMs?: number): boolean {
    const cooldown = this.resolveCooldownMs(cooldownMs);
    const key = this.keyFor(spread);
    const now = Date.now();
    const last = this.lastEmittedAt.get(key);
    if (last !== undefined && now - last < cooldown) {
      this.logger.debug(
        `Dedup cooldown active for ${key} (${now - last}ms < ${cooldown}ms); skipping`,
      );
      return false;
    }
    this.lastEmittedAt.set(key, now);
    return true;
  }

  /** Drop all cooldown records (e.g. on force-refresh / cache clear). */
  clear(): void {
    this.lastEmittedAt.clear();
  }

  /** Number of tracked keys (diagnostics). */
  get size(): number {
    return this.lastEmittedAt.size;
  }

  private keyFor(spread: CrossVenueSpread): string {
    return `${spread.canonicalToken.toLowerCase()}:${spread.buyVenue}:${spread.sellVenue}`;
  }

  private resolveCooldownMs(cooldownMs?: number): number {
    if (cooldownMs !== undefined && Number.isFinite(cooldownMs) && cooldownMs >= 0) {
      return cooldownMs;
    }
    const raw = process.env.SCANNER_DEDUP_COOLDOWN_MS ?? String(DEFAULT_SCANNER_DEDUP_COOLDOWN_MS);
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SCANNER_DEDUP_COOLDOWN_MS;
  }
}
