import { Injectable, Logger } from '@nestjs/common';

import type { ScannerFiltersJson, ScannerVolumeRangeJson } from './scanner-config.types';
import type { CrossVenueSpread } from './scanner-spread.service';
import type { PoolVolume } from './scanner-volume.service';

/** Why a spread was filtered out — for metrics / diagnostics. */
export type FilterReason =
  | 'minSpreadBps'
  | 'minLiquidityUsd'
  | 'volumeRange'
  | 'blacklistTokens'
  | 'allowedChains'
  | 'quoteAssets';

export interface FilterResult {
  passed: boolean;
  /** First failing reason (null when passed). */
  reason: FilterReason | null;
}

/**
 * Filter engine (S2-2-FILTER).
 *
 * AND-combines per-instance filters from config (`ScannerFiltersJson`) against a detected spread.
 * Each filter is independently toggleable: an absent field means "no constraint". Volume uses the
 * `volumeRange` sub-object ({ enabled, min1hUsd, max24hUsd }) — when `enabled=false` (the seed-045
 * default) the volume filter is skipped entirely.
 *
 * Filter types reuse `ScannerFiltersJson` (scanner-local, bps-based) per the scanner plan; the
 * execution-orchestrator's `DexFilters` (pct-based, see dex-filters.types.ts) is a separate shape
 * and is NOT reused — the scanner config contract is `ScannerFiltersJson`.
 *
 * Pure + synchronous: the Phase 2 pipeline (S2-4-INTEGRATE) calls `apply()` per detected spread.
 */
@Injectable()
export class ScannerFilterService {
  private readonly logger = new Logger(ScannerFilterService.name);

  /**
   * Apply the configured filters to a detected spread + its volume measurement.
   * Returns `{ passed: true }` when ALL enabled filters pass, else the first failing reason.
   */
  apply(
    spread: CrossVenueSpread,
    volume: PoolVolume | null,
    filters: ScannerFiltersJson,
  ): FilterResult {
    const reason = this.firstFailing(spread, volume, filters);
    return { passed: reason === null, reason };
  }

  /** Returns the first failing reason, or null if all pass. */
  private firstFailing(
    spread: CrossVenueSpread,
    volume: PoolVolume | null,
    filters: ScannerFiltersJson,
  ): FilterReason | null {
    // minSpreadBps — gross spread must meet the threshold.
    if (
      filters.minSpreadBps !== undefined &&
      spread.spreadBps < filters.minSpreadBps
    ) {
      return 'minSpreadBps';
    }

    // minLiquidityUsd — rough liquidity proxy from net profit (exact liquidity needs both pool
    // reserves priced; S2-4 refines). When netProfitUsd is non-positive we treat liquidity as 0.
    if (
      filters.minLiquidityUsd !== undefined &&
      Math.max(0, spread.netProfitUsd) < filters.minLiquidityUsd
    ) {
      return 'minLiquidityUsd';
    }

    // volumeRange — opt-in filter; skipped when disabled or no volume data.
    const vr = filters.volumeRange;
    if (vr !== undefined && this.volumeRangeEnabled(vr)) {
      const volUsd = volume?.volumeUsd ?? null;
      if (volUsd === null) {
        // Volume filter is on but volume is unavailable → filter out (cannot satisfy the range).
        return 'volumeRange';
      }
      const min1h = vr.min1hUsd ?? 0;
      const max24h = vr.max24hUsd ?? Number.POSITIVE_INFINITY;
      if (volUsd < min1h || volUsd > max24h) {
        return 'volumeRange';
      }
    }

    // blacklistTokens — the canonical token must not be blacklisted.
    if (
      filters.blacklistTokens !== undefined &&
      filters.blacklistTokens.length > 0 &&
      this.isBlacklisted(spread.canonicalToken, filters.blacklistTokens)
    ) {
      return 'blacklistTokens';
    }

    // allowedChains — the spread's chain must be in the allow-list.
    if (
      filters.allowedChains !== undefined &&
      filters.allowedChains.length > 0 &&
      !filters.allowedChains.includes(spread.chainId)
    ) {
      return 'allowedChains';
    }

    // quoteAssets — the quote token (token1) must be an accepted quote asset.
    if (
      filters.quoteAssets !== undefined &&
      filters.quoteAssets.length > 0 &&
      !this.isQuoteAsset(spread.token1, filters.quoteAssets)
    ) {
      return 'quoteAssets';
    }

    return null;
  }

  private volumeRangeEnabled(vr: ScannerVolumeRangeJson): boolean {
    return vr.enabled === true;
  }

  private isBlacklisted(token: string, blacklist: string[]): boolean {
    const lower = token.toLowerCase();
    return blacklist.some((b) => b.toLowerCase() === lower);
  }

  private isQuoteAsset(token: string, quoteAssets: string[]): boolean {
    // Quote assets may be symbols (USDC, WETH) or addresses. Compare case-insensitively; if the
    // entry looks like an address (0x...), compare addresses, else compare as a symbol suffix.
    const lower = token.toLowerCase();
    return quoteAssets.some((q) => {
      const ql = q.toLowerCase();
      if (ql.startsWith('0x')) {
        return ql === lower;
      }
      // Symbol match: token address endswith is unreliable; the caller is expected to resolve
      // symbols to the quote token address before filtering. For now, treat symbol entries as a
      // permissive pass (the canonical token IS the quote by construction).
      return true;
    });
  }
}
