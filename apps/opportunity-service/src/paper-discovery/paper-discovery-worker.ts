import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import { PaperDiscoveryService } from './paper-discovery.service';

/**
 * Periodic paper-only discovery (PRIO-P2-PAPERDISC).
 * Interval from `PAPER_DISCOVERY_POLL_MS` (default 300_000). Set to `0` to disable polling (e.g. CI).
 */
@Injectable()
export class PaperDiscoveryWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaperDiscoveryWorker.name);
  private intervalTimer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(private readonly paperDiscoveryService: PaperDiscoveryService) {}

  onModuleInit(): void {
    const pollMs = Number(process.env.PAPER_DISCOVERY_POLL_MS ?? '300000');
    if (!Number.isFinite(pollMs) || pollMs <= 0) {
      this.logger.log('Paper discovery polling disabled (PAPER_DISCOVERY_POLL_MS unset or 0)');
      return;
    }
    this.intervalTimer = setInterval(() => {
      void this.runDiscovery();
    }, pollMs);
    this.intervalTimer.unref?.();
    this.logger.log(`Paper discovery worker started (interval ${pollMs} ms)`);
  }

  onModuleDestroy(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
  }

  private async runDiscovery(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('Paper discovery already running, skipping cycle');
      return;
    }
    this.isRunning = true;
    try {
      await this.paperDiscoveryService.discoverPaperOpportunities();
    } catch (err) {
      this.logger.error('Paper discovery scan failed', err);
    } finally {
      this.isRunning = false;
    }
  }
}
