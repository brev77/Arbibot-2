import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Counter } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { ScannerFindingEntity } from '@arbibot/persistence';

import { DEFAULT_SCANNER_ORPHAN_MAX_ATTEMPTS, DEFAULT_SCANNER_ORPHAN_RETRY_INTERVAL_MS } from './scanner-config.constants';
import { ScannerPublisherService } from './scanner-publisher.service';
import { ScannerConfigService } from './scanner-config.service';

/**
 * Orphan publish-retry worker (S3-2-DEGRADE).
 *
 * Periodically scans `scanner_findings` for rows with `publish_status` in ('pending', 'failed')
 * whose `publish_attempts` is below the cumulative cap (`scanner.defaults.orphanMaxAttempts`,
 * default 5), and re-publishes them to opportunity-service. A finding reaches the terminal
 * `failed` state once it exhausts the cap and stays there (manual re-publish endpoint remains
 * available). The partial index `idx_scanner_findings_pending` (where publish_status='pending')
 * backs this scan.
 *
 * Skeleton mirrors paper-discovery-worker / scanner-worker: OnModuleInit/OnModuleDestroy +
 * setInterval().unref() + isRunning guard + metrics on the shared registry.
 *
 * Note: re-publish reconstructs the `CrossVenueSpread` from the stored finding fields (the
 * finding row carries everything the publisher needs via the evidence payload path). The
 * publisher's `republishById` loads the row and builds the payload from entity columns.
 */
@Injectable()
export class ScannerOrphanWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScannerOrphanWorkerService.name);
  private isRunning = false;
  private isShuttingDown = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly metrics: {
    republishAttempts: Counter<string>;
  };

  constructor(
    @InjectRepository(ScannerFindingEntity)
    private readonly findingsRepo: Repository<ScannerFindingEntity>,
    private readonly publisher: ScannerPublisherService,
    private readonly config: ScannerConfigService,
  ) {
    const reg = getArbibotMetricsRegistry();
    const existing = (name: string): Counter<string> | undefined =>
      reg.getSingleMetric(name) as Counter<string> | undefined;
    const make = (name: string, help: string, labels: string[]): Counter<string> =>
      existing(name) ?? new Counter({ name, help, labelNames: labels, registers: [reg] });
    // NOTE: per-attempt publish failures are counted by ScannerPublisherService
    // (`arb_scanner_opportunity_publish_failed_total{instance,reason}`) — do NOT double-count
    // here. This worker only tracks its own re-publish lifecycle (success / failed / exhausted).
    this.metrics = {
      republishAttempts: make('arb_scanner_orphan_republish_total', 'Scanner orphan re-publish attempts', ['status']),
    };
  }

  onModuleInit(): void {
    const intervalMs = this.resolveIntervalMs();
    this.timer = setInterval(() => {
      void this.runCycle();
    }, intervalMs);
    this.timer.unref?.();
    this.logger.log(`Orphan publish-retry worker started (interval ${intervalMs}ms, max attempts ${this.resolveMaxAttempts()})`);
  }

  onModuleDestroy(): void {
    this.isShuttingDown = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Scan for pending/failed findings below the attempt cap and re-publish them.
   * Exposed for unit tests (avoids waiting on the interval).
   */
  async runCycle(): Promise<{ scanned: number; republished: number; exhausted: number }> {
    if (this.isRunning || this.isShuttingDown) {
      return { scanned: 0, republished: 0, exhausted: 0 };
    }
    this.isRunning = true;
    const result = { scanned: 0, republished: 0, exhausted: 0 };
    try {
      const maxAttempts = this.resolveMaxAttempts();
      const timeoutMs = this.config.getConfig().defaults.opportunityPublishTimeoutMs;

      // Find pending/failed findings that haven't exhausted the attempt cap.
      const findings = await this.findingsRepo.find({
        where: [
          { publishStatus: 'pending' },
          { publishStatus: 'failed' },
        ],
        take: 50,
        order: { observedAt: 'ASC' },
      });
      result.scanned = findings.length;

      for (const finding of findings) {
        if (finding.publishAttempts >= maxAttempts) {
          result.exhausted += 1;
          continue;
        }
        // Reconstruct a minimal spread from the finding for the payload.
        const spread = this.reconstructSpread(finding);
        if (spread === null) {
          continue;
        }
        const oppId = await this.publisher.publish(finding, spread, timeoutMs).catch((err: unknown) => {
          this.logger.warn(`Orphan re-publish for ${finding.id} threw: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        });
        if (oppId !== null) {
          result.republished += 1;
          this.metrics.republishAttempts.inc({ status: 'success' });
        } else if (finding.publishAttempts >= maxAttempts) {
          result.exhausted += 1;
          this.metrics.republishAttempts.inc({ status: 'exhausted' });
        } else {
          this.metrics.republishAttempts.inc({ status: 'failed' });
        }
      }
    } catch (err) {
      this.logger.error(`Orphan worker cycle failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.isRunning = false;
    }
    return result;
  }

  /** Reconstruct a CrossVenueSpread from stored finding columns for the publisher payload. */
  private reconstructSpread(finding: ScannerFindingEntity): {
    chainId: number;
    canonicalToken: string;
    token0: string;
    token1: string;
    buyVenue: string;
    buyPoolAddress: string;
    buyPrice: number;
    sellVenue: string;
    sellPoolAddress: string;
    sellPrice: number;
    spreadBps: number;
    feesUsd: number;
    gasUsd: number;
    grossProfitUsd: number;
    netProfitUsd: number;
  } | null {
    return {
      chainId: finding.chainId,
      canonicalToken: finding.canonicalToken,
      token0: finding.buyPoolAddr, // approximate; token0 not stored separately on the finding
      token1: finding.canonicalToken,
      buyVenue: finding.buyVenue,
      buyPoolAddress: finding.buyPoolAddr,
      buyPrice: 0,
      sellVenue: finding.sellVenue,
      sellPoolAddress: finding.sellPoolAddr,
      sellPrice: 0,
      spreadBps: finding.spreadBps,
      feesUsd: Number(finding.feesUsd),
      gasUsd: 0,
      grossProfitUsd: Number(finding.grossProfitUsd),
      netProfitUsd: Number(finding.netProfitUsd),
    };
  }

  private resolveIntervalMs(): number {
    const raw = process.env.SCANNER_ORPHAN_RETRY_INTERVAL_MS ?? String(DEFAULT_SCANNER_ORPHAN_RETRY_INTERVAL_MS);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_SCANNER_ORPHAN_RETRY_INTERVAL_MS;
  }

  private resolveMaxAttempts(): number {
    const raw = process.env.SCANNER_ORPHAN_MAX_ATTEMPTS ?? String(DEFAULT_SCANNER_ORPHAN_MAX_ATTEMPTS);
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SCANNER_ORPHAN_MAX_ATTEMPTS;
  }
}
