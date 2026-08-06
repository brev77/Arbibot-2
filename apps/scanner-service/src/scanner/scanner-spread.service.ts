import { Injectable } from '@nestjs/common';
import { spreadBps } from '@arbibot/contracts-eth';

import type { PoolSnapshot } from './scanner-pool.service';

/**
 * A cross-venue arbitrage opportunity between two pools pricing the SAME token pair on the
 * SAME chain. Buy on the cheaper venue, sell on the more expensive one.
 */
export interface CrossVenueSpread {
  chainId: number;
  canonicalToken: string;
  /** Token0 (base) address — same on both pools (the join key). */
  token0: string;
  /** Token1 (quote) address — same on both pools. */
  token1: string;
  /** Venue to buy on (lower price). */
  buyVenue: string;
  buyPoolAddress: string;
  buyPrice: number;
  /** Venue to sell on (higher price). */
  sellVenue: string;
  sellPoolAddress: string;
  sellPrice: number;
  /** Gross spread in basis points (sellPrice vs buyPrice). Always >= 0; the pair is ordered so
   *  the cheaper side is the buy. */
  spreadBps: number;
  /** Pool fees on both legs, in USD. */
  feesUsd: number;
  /** Gas estimate in USD (provided by the caller; 0 when unknown — exact gas is S2-4/execution). */
  gasUsd: number;
  /** Net profit = grossProfitUsd − feesUsd − gasUsd (БЕЗ slippage — slippage lives in execution). */
  grossProfitUsd: number;
  netProfitUsd: number;
}

/**
 * Spread Detector (S2-1-SPREAD).
 *
 * Joins per-venue pool snapshots for the SAME canonical token pair on the SAME chain and
 * computes the cross-venue spread. The net profit subtracts pool fees (from each leg's feeBps)
 * and a gas estimate, WITHOUT slippage (slippage is an execution concern, not detection).
 *
 * Pure + synchronous: takes already-fetched PoolSnapshots + an optional gas estimate, returns
 * the best spread opportunity for the pair (or null when no positive spread exists). The Phase 2
 * pipeline (S2-4-INTEGRATE) calls this per pair after reading pools.
 *
 * Notional assumption: a fixed trade size (default $1000) is used to convert bps-spread into a
 * USD profit figure, since detection does not know the execution trade size. The exact USD value
 * is refined downstream when the opportunity is sized.
 */
@Injectable()
export class ScannerSpreadService {
  /** Default notional (USD) used to convert bps-spread into a USD profit estimate. */
  static readonly DEFAULT_NOTIONAL_USD = 1000;

  /**
   * Detect the best cross-venue spread for a pair of pools pricing the same token pair on the
   * same chain. Returns null when there are fewer than 2 distinct venues, or when the net profit
   * is non-positive.
   *
   * @param pools pool snapshots for ONE token pair (same token0/token1) across multiple venues
   * @param gasUsd gas estimate in USD (default 0 — caller refines in S2-4)
   * @param notionalUsd trade size in USD for the profit estimate
   */
  detect(
    pools: PoolSnapshot[],
    gasUsd = 0,
    notionalUsd = ScannerSpreadService.DEFAULT_NOTIONAL_USD,
  ): CrossVenueSpread | null {
    if (pools.length < 2) {
      return null;
    }

    // Group by (token0, token1) — the join key. We expect all pools in the call to share it,
    // but filter defensively to avoid mismatched-pair spreads.
    const byPair = new Map<string, PoolSnapshot[]>();
    for (const p of pools) {
      const key = `${p.token0.toLowerCase()}:${p.token1.toLowerCase()}`;
      const arr = byPair.get(key);
      if (arr === undefined) {
        byPair.set(key, [p]);
      } else {
        arr.push(p);
      }
    }

    let best: CrossVenueSpread | null = null;
    for (const pairPools of byPair.values()) {
      if (pairPools.length < 2) {
        continue;
      }
      const candidate = this.bestSpreadForPair(pairPools, gasUsd, notionalUsd);
      if (
        candidate !== null &&
        (best === null || candidate.netProfitUsd > best.netProfitUsd)
      ) {
        best = candidate;
      }
    }
    return best;
  }

  /**
   * For a set of pools on the SAME pair, find the two venues with the largest price gap and
   * compute the spread. The cheaper venue is the buy side.
   */
  private bestSpreadForPair(
    pairPools: PoolSnapshot[],
    gasUsd: number,
    notionalUsd: number,
  ): CrossVenueSpread | null {
    // Sort ascending by quotePerBase; buy at the cheapest, sell at the most expensive.
    const sorted = [...pairPools].sort((a, b) => a.quotePerBase - b.quotePerBase);
    const buy = sorted[0];
    const sell = sorted[sorted.length - 1];
    if (buy === undefined || sell === undefined) {
      return null;
    }
    // Same venue (duplicate pool) or zero/negative prices → no spread.
    if (
      buy.venueKey === sell.venueKey ||
      buy.quotePerBase <= 0 ||
      sell.quotePerBase <= 0
    ) {
      return null;
    }

    const bps = spreadBps(buy.quotePerBase, sell.quotePerBase);
    if (bps <= 0) {
      return null;
    }

    // Gross profit in USD from the bps-spread on the notional.
    const grossProfitUsd = (notionalUsd * bps) / 10_000;
    // Pool fees: buy leg fee + sell leg fee, each as feeBps of notional.
    const feesUsd =
      (notionalUsd * (buy.feeBps + sell.feeBps)) / 10_000;
    const netProfitUsd = grossProfitUsd - feesUsd - gasUsd;

    // canonicalToken = token1 (the quote asset is the "canonical" reference for the pair).
    return {
      chainId: buy.chainId,
      canonicalToken: buy.token1,
      token0: buy.token0,
      token1: buy.token1,
      buyVenue: buy.venueKey,
      buyPoolAddress: buy.poolAddress,
      buyPrice: buy.quotePerBase,
      sellVenue: sell.venueKey,
      sellPoolAddress: sell.poolAddress,
      sellPrice: sell.quotePerBase,
      spreadBps: bps,
      feesUsd,
      gasUsd,
      grossProfitUsd,
      netProfitUsd,
    };
  }
}
