import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PaperDiscoveryService } from './paper-discovery.service';

/**
 * Paper discovery worker (PRIO-P2-PAPERDISC).
 * Periodically scans for paper-only opportunities and creates candidates.
 *
 * Schedule: Every 5 minutes by default (configurable via env).
 * In production: Use @nestjs/schedule with Bull/Redis-backed queue for reliability.
 */
@Injectable()
export class PaperDiscoveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaperDiscoveryWorker.name);

  // Worker state
  private isRunning = false;
  private cronJob: any;
  private intervalTimer?: NodeJS.Timeout;

  constructor(private readonly paperDiscoveryService: PaperDiscoveryService) {}

  async onModuleInit() {
    // Determine schedule based on environment
    const cronSchedule = this.getCronSchedule();

    this.logger.log(`Initializing paper discovery worker with schedule: ${cronSchedule}`);

    // Set up cron job for periodic discovery
    this.cronJob = Cron.Cron(cronSchedule, async () => {
      await this.runDiscovery();
    });

    this.logger.log('Paper discovery worker initialized');
  }

  async onModuleDestroy() {
    this.logger.log('Destroying paper discovery worker');

    // Clear cron job
    if (this.cronJob) {
      this.cronJob.stop();
    }

    // Clear interval timer
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
    }

    // Wait for current run to finish (max 60s)
    const waitStart = Date.now();
    while (this.isRunning && Date.now() - waitStart < 60000) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  /**
   * Run paper discovery scan.
   */
  private async runDiscovery(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Discovery already running, skipping this cycle');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      this.logger.log('Starting paper discovery scan');

      const result = await this.paperDiscoveryService.discoverPaperOpportunities();

      this.logger.log(
        `Paper discovery scan completed: ${result.discovered} opportunities created, ${result.errors} errors`,
      );

      const duration = Date.now() - startTime;
      this.logger.log(`Paper discovery scan duration: ${duration}ms`);
    } catch (error) {
      this.logger.error('Paper discovery scan failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get cron schedule expression based on environment.
   * Dev: Every 5 minutes for faster testing.
   * Production: Every 30 minutes to reduce load.
   */
  private getCronSchedule(): CronExpression {
    const env = process.env.NODE_ENV || 'development';

    if (env === 'development') {
      // Every 5 minutes in dev
      return '*/5 * * * *' as CronExpression;
    } else {
      // Every 30 minutes in production
      return '*/30 * * * *' as CronExpression;
    }
  }

  /**
   * Manually trigger discovery (for testing and E2E).
   * Called by E2E script via dedicated endpoint.
   */
  async triggerDiscovery(): Promise<void> {
    this.logger.log('Manual discovery trigger requested');
    await this.runDiscovery();
  }
}
