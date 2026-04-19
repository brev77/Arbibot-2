import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Counter, Histogram } from 'prom-client';

import { PaperDiscoveryService } from './paper-discovery.service';

/**
 * Paper Discovery Worker (P3-4)
 *
 * Scheduled worker that automatically discovers paper-only arbitrage opportunities.
 * Runs on a configurable interval (default: 30s).
 *
 * Workflow:
 * 1. Polls fresh snapshots from market-intake
 * 2. Filters by paper-only tokens/routes
 * 3. Profiles candidates (profit, liquidity, eligibility)
 * 4. Creates discovery records in database
 * 5. Logs metrics (candidates found, eligible, enqueued, latency)
 */
@Injectable()
export class PaperDiscoveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaperDiscoveryWorker.name);
  private isRunning = false;
  private isShuttingDown = false;
  private discoveryInterval: ReturnType<typeof setInterval> | null = null;

  // Prometheus metrics (bind to shared registry — avoid defaultRegistry duplicate names in tests)
  private readonly metrics = (() => {
    const reg = getArbibotMetricsRegistry();
    return {
      candidatesFound: new Counter({
        name: 'arb_paper_discovery_candidates_total',
        help: 'Total paper discovery candidates found per run',
        labelNames: ['status'], // eligible, ineligible
        registers: [reg],
      }),
      candidatesEligible: new Counter({
        name: 'arb_paper_discovery_eligible_total',
        help: 'Total eligible paper discovery candidates',
        registers: [reg],
      }),
      candidatesProcessedCounter: new Counter({
        name: 'arb_paper_discovery_processed_total',
        help: 'Total paper discovery candidates successfully processed per cycle',
        registers: [reg],
      }),
      latency: new Histogram({
        name: 'arb_paper_discovery_latency_ms',
        help: 'Paper discovery cycle latency in milliseconds',
        buckets: [500, 1000, 2000, 5000, 10000, 30000],
        registers: [reg],
      }),
      cyclesTotal: new Counter({
        name: 'arb_paper_discovery_cycles_total',
        help: 'Total discovery cycles completed',
        labelNames: ['status'], // success, error
        registers: [reg],
      }),
    };
  })();

  constructor(private readonly discoveryService: PaperDiscoveryService) {}

  onModuleInit(): void {
    // Metrics use registers: [getArbibotMetricsRegistry()] — already on shared registry
    this.startDiscoveryWorker();
  }

  onModuleDestroy(): void {
    this.isShuttingDown = true;
    if (this.discoveryInterval !== null) {
      clearInterval(this.discoveryInterval);
      this.discoveryInterval = null;
    }
    this.logger.log('Paper discovery worker shutting down...');
  }

  /**
   * Start the discovery worker
   * Schedules the discovery run based on configuration
   */
  private startDiscoveryWorker(): void {
    if (!this.discoveryService.isEnabled()) {
      this.logger.log('Paper discovery is disabled, skipping worker startup');
      return;
    }

    const config = this.discoveryService.getConfig();
    this.logger.log(
      `Starting paper discovery worker with interval ${config.intervalMs}ms`,
    );

    // Register cron job
    // Note: Using setInterval for simplicity - can be enhanced to use CronExpression
    const intervalMs = config.intervalMs;
    this.discoveryInterval = setInterval(() => {
      void this.runDiscoveryCycle();
    }, intervalMs);
    this.discoveryInterval.unref?.();

    // Run first cycle immediately
    void this.runDiscoveryCycle();
  }

  /**
   * Run a single discovery cycle
   * Executes the discovery workflow and logs metrics
   */
  private async runDiscoveryCycle(): Promise<void> {
    // Prevent concurrent runs
    if (this.isRunning) {
      this.logger.warn('Discovery cycle already in progress, skipping');
      return;
    }

    // Check if shutting down
    if (this.isShuttingDown) {
      this.logger.log('Shutting down, skipping discovery cycle');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      this.logger.debug('Starting discovery cycle...');

      // Run discovery workflow
      const result = await this.discoveryService.runDiscoveryCycle();

      // Record metrics
      const elapsed = Date.now() - startTime;
      this.metrics.latency.observe(elapsed);
      this.metrics.cyclesTotal.inc({ status: 'success' });

      this.metrics.candidatesFound.inc(
        { status: 'eligible' },
        result.candidatesEligible,
      );
      this.metrics.candidatesFound.inc(
        { status: 'ineligible' },
        result.candidatesFound - result.candidatesEligible,
      );

      this.metrics.candidatesEligible.inc(result.candidatesEligible);
      this.metrics.candidatesProcessedCounter.inc(result.candidatesProcessed);

      this.logger.log(
        `Discovery cycle completed: ` +
          `${result.candidatesFound} found, ` +
          `${result.candidatesEligible} eligible, ` +
          `${result.candidatesProcessed} processed in ${elapsed}ms`,
      );

      if (result.error !== null) {
        this.logger.warn(`Discovery cycle completed with error: ${result.error}`);
      }
    } catch (err) {
      const elapsed = Date.now() - startTime;
      const error = err instanceof Error ? err.message : String(err);

      this.logger.error(`Discovery cycle failed: ${error}`);

      // Record failure metric
      this.metrics.latency.observe(elapsed);
      this.metrics.cyclesTotal.inc({ status: 'error' });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Manual trigger for discovery cycle (useful for testing)
   */
  async triggerDiscovery(): Promise<{
    success: boolean;
    message: string;
  }> {
    this.logger.log('Manual trigger of discovery cycle requested');

    if (this.isRunning) {
      return {
        success: false,
        message: 'Discovery cycle already in progress',
      };
    }

    try {
      await this.runDiscoveryCycle();
      return {
        success: true,
        message: 'Discovery cycle completed',
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        message: `Discovery cycle failed: ${error}`,
      };
    }
  }

  /**
   * Get worker status
   */
  getStatus(): {
    isRunning: boolean;
    isShuttingDown: boolean;
    config: ReturnType<PaperDiscoveryService['getConfig']>;
  } {
    return {
      isRunning: this.isRunning,
      isShuttingDown: this.isShuttingDown,
      config: this.discoveryService.getConfig(),
    };
  }
}
