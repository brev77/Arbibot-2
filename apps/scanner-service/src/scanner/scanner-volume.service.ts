import { Injectable, Logger } from '@nestjs/common';
import { Contract } from 'ethers';
import { Counter } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { DEFAULT_V2_WINDOW_SECONDS, blockWindowFor, V2_SWAP_EVENT_ABI } from './scanner-volume.constants';
import { UNI_V3_POOL_SCANNER_ABI } from './scanner-pool.constants';
import { ScannerRpcService } from './scanner-rpc.service';
import { ScannerPoolService } from './scanner-pool.service';
import type { PoolSnapshot } from './scanner-pool.service';

/** Resolved volume in USD for a pool over a window. `null` = unavailable (volume filter off / revert). */
export interface PoolVolume {
  chainId: number;
  poolAddress: string;
  /** Volume window in seconds (1h default). */
  windowSeconds: number;
  /** Approximate USD volume over the window; null when unavailable. */
  volumeUsd: number | null;
  /** Strategy used: 'v3-cumulative' | 'v2-logs' | 'none'. */
  strategy: 'v3-cumulative' | 'v2-logs' | 'none';
  /** Block range scanned (V2 logs only). */
  blockRange?: { fromBlock: number; toBlock: number };
}

interface V3VolumeBaseline {
  volumeToken0: bigint;
  volumeToken1: bigint;
  at: number;
}

/**
 * Scanner volume reader (S1-6-VOLUME).
 *
 * Reads on-chain pool volume to feed the `volumeRange` filter (S2-2). Two strategies:
 *   - V3 cumulative: `volumeToken0()`/`volumeToken1()` (single view call) diffed against a
 *     per-pool baseline captured on the previous read. Mainnet-canonical UniV3 only; a revert
 *     (fork/testnet without the getter) degrades to `none` and increments
 *     `arb_scanner_volume_revert_total`.
 *   - V2 short-window: `eth_getLogs` over the Swap event for a bounded block range (~1h,
 *     capped at {@link MAX_V2_LOG_BLOCK_WINDOW}), summing amount0In+amount1In. 24h V2 is a non-goal.
 *
 * Volume in USD requires a token price; this slice returns raw token amounts + strategy, and the
 * Phase 2 spread detector (which has the quote price) converts to USD. Default OFF — callers gate
 * on `filters.volumeRange.enabled`.
 *
 * Rate budget: every read consults {@link ScannerRpcService.tryAcquire}.
 */
@Injectable()
export class ScannerVolumeService {
  private readonly logger = new Logger(ScannerVolumeService.name);
  private readonly v3Baseline = new Map<string, V3VolumeBaseline>();

  private readonly metrics: {
    volumeReads: Counter<string>;
    volumeReverts: Counter<string>;
    volumeLogScans: Counter<string>;
  };

  constructor(
    private readonly rpc: ScannerRpcService,
    private readonly poolService: ScannerPoolService,
  ) {
    const reg = getArbibotMetricsRegistry();
    const existing = (name: string): Counter<string> | undefined =>
      reg.getSingleMetric(name) as Counter<string> | undefined;
    const make = (name: string, help: string, labelNames: string[]): Counter<string> =>
      existing(name) ?? new Counter({ name, help, labelNames, registers: [reg] });
    this.metrics = {
      volumeReads: make('arb_scanner_volume_reads_total', 'Scanner pool volume reads', ['chain_id', 'strategy']),
      volumeReverts: make('arb_scanner_volume_revert_total', 'Scanner V3 volumeToken0/1 reverts', ['chain_id']),
      volumeLogScans: make('arb_scanner_volume_log_scans_total', 'Scanner V2 Swap-log scans', ['chain_id']),
    };
  }

  /**
   * Read a pool's volume. Returns `{ strategy: 'none', volumeUsd: null }` when volume is off or
   * unavailable. The caller decides whether the `volumeRange` filter applies.
   *
   * @param snapshot the pool snapshot from {@link ScannerPoolService.readPool} (provides family).
   */
  async readVolume(
    snapshot: PoolSnapshot,
    windowSeconds: number = DEFAULT_V2_WINDOW_SECONDS,
  ): Promise<PoolVolume> {
    if (snapshot.family === 'v3') {
      return this.readV3Cumulative(snapshot, windowSeconds).catch(() =>
        this.noneResult(snapshot.chainId, snapshot.poolAddress, windowSeconds),
      );
    }
    if (snapshot.family === 'v2') {
      return this.readV2Logs(snapshot, windowSeconds).catch(() =>
        this.noneResult(snapshot.chainId, snapshot.poolAddress, windowSeconds),
      );
    }
    return this.noneResult(snapshot.chainId, snapshot.poolAddress, windowSeconds);
  }

  /** Drop the V3 cumulative baseline for a pool (e.g. on cache clear / force-refresh). */
  clearBaseline(poolAddress: string): void {
    this.v3Baseline.delete(`${poolAddress.toLowerCase()}`);
  }

  // --- V3 cumulative -------------------------------------------------------

  private async readV3Cumulative(
    snapshot: PoolSnapshot,
    windowSeconds: number,
  ): Promise<PoolVolume> {
    const cacheKey = `${snapshot.poolAddress.toLowerCase()}`;
    if (!this.rpc.tryAcquire(snapshot.chainId)) {
      this.logger.debug(`RPC rate-limited for V3 volume chain ${snapshot.chainId}`);
      return this.noneResult(snapshot.chainId, snapshot.poolAddress, windowSeconds);
    }

    const provider = this.rpc.getProvider(snapshot.chainId);
    const contract = new Contract(snapshot.poolAddress, [...UNI_V3_POOL_SCANNER_ABI], provider) as unknown as {
      volumeToken0(): Promise<bigint>;
      volumeToken1(): Promise<bigint>;
    };

    let current0: bigint;
    let current1: bigint;
    try {
      [current0, current1] = await Promise.all([
        contract.volumeToken0(),
        contract.volumeToken1(),
      ]);
    } catch (err) {
      // Fork/testnet without the getter — graceful revert (корр. #1 раунда 2/4).
      this.metrics.volumeReverts.inc({ chain_id: String(snapshot.chainId) });
      this.logger.debug(
        `V3 volumeToken revert for ${snapshot.poolAddress}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.noneResult(snapshot.chainId, snapshot.poolAddress, windowSeconds);
    }

    const baseline = this.v3Baseline.get(cacheKey);
    this.v3Baseline.set(cacheKey, { volumeToken0: current0, volumeToken1: current1, at: Date.now() });

    if (baseline === undefined) {
      // First read seeds the baseline; no delta available yet.
      this.metrics.volumeReads.inc({ chain_id: String(snapshot.chainId), strategy: 'v3-cumulative' });
      return {
        chainId: snapshot.chainId,
        poolAddress: snapshot.poolAddress,
        windowSeconds,
        volumeUsd: null,
        strategy: 'v3-cumulative',
      };
    }

    // Volume accumulates monotonically; handle wraparound (unlikely on mainnet) by clamping to >=0.
    const delta0 = current0 > baseline.volumeToken0 ? current0 - baseline.volumeToken0 : 0n;
    const delta1 = current1 > baseline.volumeToken1 ? current1 - baseline.volumeToken1 : 0n;
    // Convert to USD using the snapshot quote price: volume in token0 + token1, priced in quote.
    // token0 is the base, token1 is the quote (per scanner convention: quotePerBase = token1/token0).
    // volumeUsd ≈ (delta0 * quotePerBase + delta1) / 10^decimals1 (rough; exact USD needs both token prices).
    const volumeUsd = this.estimateVolumeUsd(delta0, delta1, snapshot);

    this.metrics.volumeReads.inc({ chain_id: String(snapshot.chainId), strategy: 'v3-cumulative' });
    return {
      chainId: snapshot.chainId,
      poolAddress: snapshot.poolAddress,
      windowSeconds,
      volumeUsd,
      strategy: 'v3-cumulative',
    };
  }

  // --- V2 Swap logs --------------------------------------------------------

  private async readV2Logs(
    snapshot: PoolSnapshot,
    windowSeconds: number,
  ): Promise<PoolVolume> {
    if (!this.rpc.tryAcquire(snapshot.chainId)) {
      this.logger.debug(`RPC rate-limited for V2 volume chain ${snapshot.chainId}`);
      return this.noneResult(snapshot.chainId, snapshot.poolAddress, windowSeconds);
    }

    const provider = this.rpc.getProvider(snapshot.chainId);
    const toBlock = await provider.getBlockNumber().catch(() => null);
    if (toBlock === null) {
      return this.noneResult(snapshot.chainId, snapshot.poolAddress, windowSeconds);
    }
    const blockWindow = blockWindowFor(snapshot.chainId, windowSeconds);
    const fromBlock = Math.max(0, toBlock - blockWindow);

    const contract = new Contract(snapshot.poolAddress, [...V2_SWAP_EVENT_ABI], provider) as unknown as {
      queryFilter(event: string, from: number, to: number): Promise<ReadonlyArray<{ args: ReadonlyArray<bigint> }>>;
    };

    let logs: ReadonlyArray<{ args: ReadonlyArray<bigint> }>;
    try {
      logs = await contract.queryFilter('Swap', fromBlock, toBlock);
    } catch (err) {
      this.logger.debug(
        `V2 Swap-log scan failed for ${snapshot.poolAddress}: ${err instanceof Error ? err.message : String(err)}`,
      );
      this.metrics.volumeLogScans.inc({ chain_id: String(snapshot.chainId) });
      return this.noneResult(snapshot.chainId, snapshot.poolAddress, windowSeconds);
    }

    // Sum amount0In + amount1In across all swaps in the window.
    let sum0 = 0n;
    let sum1 = 0n;
    for (const log of logs) {
      // V2 Swap args: [amount0In, amount1In, amount0Out, amount1Out]
      const amount0In = log.args[0] ?? 0n;
      const amount1In = log.args[1] ?? 0n;
      sum0 += amount0In;
      sum1 += amount1In;
    }
    const volumeUsd = this.estimateVolumeUsd(sum0, sum1, snapshot);

    this.metrics.volumeLogScans.inc({ chain_id: String(snapshot.chainId) });
    this.metrics.volumeReads.inc({ chain_id: String(snapshot.chainId), strategy: 'v2-logs' });
    return {
      chainId: snapshot.chainId,
      poolAddress: snapshot.poolAddress,
      windowSeconds,
      volumeUsd,
      strategy: 'v2-logs',
      blockRange: { fromBlock, toBlock },
    };
  }

  // --- helpers -------------------------------------------------------------

  /**
   * Rough USD volume estimate from token amounts + a snapshot quote price.
   * volumeUsd ≈ (deltaBase * quotePerBase + deltaQuote) / 10^decimalsQuote
   * Where decimalsQuote = snapshot.decimals1 (token1 = quote). This is approximate; the exact
   * USD value needs both token USD prices, which arrives in the Phase 2 spread detector.
   */
  private estimateVolumeUsd(
    deltaBase: bigint,
    deltaQuote: bigint,
    snapshot: PoolSnapshot,
  ): number | null {
    if (snapshot.quotePerBase <= 0) {
      return null;
    }
    const SCALED = 10n ** 18n;
    const quoteFromBase = (deltaBase * BigInt(Math.round(snapshot.quotePerBase * 1e6)) * SCALED) /
      (10n ** BigInt(snapshot.decimals0) * BigInt(10 ** 6));
    const quoteFromQuote = (deltaQuote * SCALED) / 10n ** BigInt(snapshot.decimals1);
    const totalQuote = quoteFromBase + quoteFromQuote;
    return Number(totalQuote) / 1e18;
  }

  private noneResult(
    chainId: number,
    poolAddress: string,
    windowSeconds: number,
  ): PoolVolume {
    return {
      chainId,
      poolAddress,
      windowSeconds,
      volumeUsd: null,
      strategy: 'none',
    };
  }
}
