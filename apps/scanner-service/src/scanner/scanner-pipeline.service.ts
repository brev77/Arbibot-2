import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Counter, Histogram } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { ScannerFindingEntity } from '@arbibot/persistence';

import type { ScannerInstanceJson } from './scanner-config.types';
import { ScannerPoolService } from './scanner-pool.service';
import { ScannerVolumeService } from './scanner-volume.service';
import { ScannerSpreadService } from './scanner-spread.service';
import { ScannerFilterService } from './scanner-filter.service';
import { ScannerDedupService } from './scanner-dedup.service';
import { ScannerPublisherService } from './scanner-publisher.service';
import { ScannerConfigService } from './scanner-config.service';
import type { PoolSnapshot } from './scanner-pool.service';
import type { CrossVenueSpread } from './scanner-spread.service';

/**
 * Pipeline orchestrator (S2-4-INTEGRATE).
 *
 * Runs one detection cycle for a scanner instance:
 *   1. Read all whitelisted pools for the instance (grouped by token pair)
 *   2. Detect cross-venue spreads (S2-1)
 *   3. Measure volume per pool (S1-6) — only when the volume filter is enabled
 *   4. Apply per-instance filters (S2-2)
 *   5. Dedup cooldown (S2-3)
 *   6. WRITE surviving findings to `scanner_findings` (publish_status='pending'; Phase 3 publishes)
 *
 * The worker (ScannerWorkerService.runInstanceCycle) delegates the body to this service. Findings
 * are single-writer scanner-service rows; the Phase 3 publisher turns pending → published.
 */
@Injectable()
export class ScannerPipelineService {
  private readonly logger = new Logger(ScannerPipelineService.name);

  private readonly metrics: {
    spreadsDetected: Counter<string>;
    findingsWritten: Counter<string>;
    findingsFiltered: Counter<string>;
    spreadBps: Histogram<string>;
    volumeUsd: Histogram<string>;
  };

  constructor(
    private readonly poolService: ScannerPoolService,
    private readonly volumeService: ScannerVolumeService,
    private readonly spreadService: ScannerSpreadService,
    private readonly filterService: ScannerFilterService,
    private readonly dedupService: ScannerDedupService,
    private readonly publisher: ScannerPublisherService,
    private readonly config: ScannerConfigService,
    @InjectRepository(ScannerFindingEntity)
    private readonly findingsRepo: Repository<ScannerFindingEntity>,
  ) {
    const reg = getArbibotMetricsRegistry();
    const existingCounter = (name: string): Counter<string> | undefined =>
      reg.getSingleMetric(name) as Counter<string> | undefined;
    const makeCounter = (name: string, help: string, labels: string[]): Counter<string> =>
      existingCounter(name) ??
      new Counter({ name, help, labelNames: labels, registers: [reg] });
    const makeHistogram = (
      name: string,
      help: string,
      labels: string[],
      buckets: number[],
    ): Histogram<string> =>
      (reg.getSingleMetric(name) as Histogram<string> | undefined) ??
      new Histogram({ name, help, labelNames: labels, buckets, registers: [reg] });
    this.metrics = {
      spreadsDetected: makeCounter('arb_scanner_spreads_detected_total', 'Cross-venue spreads detected', ['instance']),
      findingsWritten: makeCounter('arb_scanner_findings_written_total', 'Scanner findings written to DB', ['instance']),
      findingsFiltered: makeCounter('arb_scanner_findings_filtered_total', 'Scanner findings filtered out', ['instance', 'reason']),
      // Spread distribution (bps) per instance — informs filter tuning (minSpreadBps).
      spreadBps: makeHistogram(
        'arb_scanner_spread_bps',
        'Detected cross-venue spread in basis points',
        ['instance'],
        [5, 10, 20, 30, 50, 75, 100, 150, 200, 300, 500, 1000],
      ),
      // Observed volume (USD) over the filter window per instance + window label.
      volumeUsd: makeHistogram(
        'arb_scanner_volume_usd',
        'Observed pool volume in USD over the filter window',
        ['instance', 'window'],
        [1000, 10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000],
      ),
    };
  }

  /**
   * Run the detection pipeline for one instance. Returns a summary of the cycle.
   */
  async runCycle(instance: ScannerInstanceJson): Promise<{
    poolsRead: number;
    spreadsDetected: number;
    findingsWritten: number;
    findingsFiltered: number;
    error: string | null;
  }> {
    const result = {
      poolsRead: 0,
      spreadsDetected: 0,
      findingsWritten: 0,
      findingsFiltered: 0,
      error: null as string | null,
    };

    try {
      const pools = await this.readInstancePools(instance);
      result.poolsRead = pools.length;
      if (pools.length === 0) {
        return result;
      }

      // Group pools by token pair, then detect spreads per pair.
      const byPair = this.groupByPair(pools);
      const volumeEnabled = instance.filters?.volumeRange?.enabled === true;

      for (const pairPools of byPair.values()) {
        const spread = this.spreadService.detect(pairPools);
        if (spread === null) {
          continue;
        }
        result.spreadsDetected += 1;
        this.metrics.spreadsDetected.inc({ instance: instance.id });
        // Record the spread distribution regardless of filter outcome — it informs tuning.
        if (typeof spread.spreadBps === 'number' && Number.isFinite(spread.spreadBps)) {
          this.metrics.spreadBps.observe({ instance: instance.id }, spread.spreadBps);
        }

        // Volume (only when the filter needs it; skip RPC otherwise — S1-6 default OFF).
        const volume = volumeEnabled
          ? await this.volumeService.readVolume(spread as unknown as PoolSnapshot).catch(() => null)
          : null;
        if (volume !== null && typeof volume.volumeUsd === 'number' && Number.isFinite(volume.volumeUsd)) {
          this.metrics.volumeUsd.observe(
            { instance: instance.id, window: '1h' },
            volume.volumeUsd,
          );
        }

        // Filters.
        const filters = instance.filters ?? {};
        const filterResult = this.filterService.apply(spread, volume, filters);
        if (!filterResult.passed) {
          result.findingsFiltered += 1;
          this.metrics.findingsFiltered.inc({ instance: instance.id, reason: filterResult.reason ?? 'unknown' });
          continue;
        }

        // Dedup.
        if (!this.dedupService.shouldEmit(spread)) {
          continue;
        }

        // Write finding (pending), then publish to opportunity-service (S3-1-PUBLISH).
        const finding = await this.writeFinding(instance.id, spread, volume?.volumeUsd ?? null);
        result.findingsWritten += 1;
        this.metrics.findingsWritten.inc({ instance: instance.id });

        // Publish immediately; on failure the finding stays 'failed' and the orphan worker
        // (S3-2-DEGRADE) retries it. Non-blocking for the cycle — a publish failure does not
        // abort detection of other pairs in the same cycle.
        const timeoutMs = this.config.getConfig().defaults.opportunityPublishTimeoutMs;
        await this.publisher.publish(finding, spread, timeoutMs).catch((err: unknown) => {
          this.logger.warn(
            `Finding ${finding.id} publish threw: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }

      return result;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Pipeline cycle failed for instance ${instance.id}: ${result.error}`);
      return result;
    }
  }

  /** Read all whitelisted pools for an instance (parallel, rate-gated by ScannerRpcService). */
  private async readInstancePools(instance: ScannerInstanceJson): Promise<PoolSnapshot[]> {
    const whitelist = instance.poolWhitelist ?? [];
    if (whitelist.length === 0) {
      return [];
    }
    // Resolve chainId from the instance network; default to Arbitrum for the MVP strategy.
    const chainId = this.resolveChainId(instance.network);
    if (chainId === null) {
      this.logger.warn(`Instance ${instance.id}: unknown network ${instance.network}, skipping`);
      return [];
    }
    const snapshots = await Promise.all(
      whitelist.map((addr) => this.poolService.readPool(chainId, addr).catch(() => null)),
    );
    return snapshots.filter((s): s is PoolSnapshot => s !== null);
  }

  private groupByPair(pools: PoolSnapshot[]): Map<string, PoolSnapshot[]> {
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
    return byPair;
  }

  private resolveChainId(network: string): number | null {
    switch (network.toLowerCase()) {
      case 'arbitrum':
        return 42161;
      case 'base':
        return 8453;
      case 'bnb':
      case 'bsc':
        return 56;
      case 'ethereum':
      case 'eth':
      case 'mainnet':
        return 1;
      default:
        return null;
    }
  }

  private async writeFinding(
    instanceId: string,
    spread: CrossVenueSpread,
    volume1hUsd: number | null,
  ): Promise<ScannerFindingEntity> {
    const row = this.findingsRepo.create({
      instanceId,
      opportunityId: null,
      publishStatus: 'pending',
      publishAttempts: 0,
      canonicalToken: spread.canonicalToken,
      chainId: spread.chainId,
      buyVenue: spread.buyVenue,
      sellVenue: spread.sellVenue,
      buyPoolAddr: spread.buyPoolAddress,
      sellPoolAddr: spread.sellPoolAddress,
      spreadBps: spread.spreadBps,
      grossProfitUsd: String(spread.grossProfitUsd.toFixed(6)),
      netProfitUsd: String(spread.netProfitUsd.toFixed(6)),
      feesUsd: String(spread.feesUsd.toFixed(6)),
      volume1hUsd: volume1hUsd !== null ? String(volume1hUsd.toFixed(8)) : null,
      volume24hUsd: null,
    });
    return this.findingsRepo.save(row);
  }
}
