import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Counter, Gauge } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { BridgeTransferService } from '../bridge/bridge-transfer.service';
import { BridgeAdapterFactoryService } from '../bridge/bridge-adapter-factory.service';

// ───────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────

/** Default polling interval: 30 seconds. */
const DEFAULT_POLL_INTERVAL_MS = 30_000;

/** Default max polling duration before considering a transfer timed out: 30 minutes. */
const _DEFAULT_MAX_POLL_DURATION_MS = 1_800_000;

// ───────────────────────────────────────────────────────────────────────
// Worker
// ───────────────────────────────────────────────────────────────────────

/**
 * Bridge transfer polling worker.
 *
 * Step: DEX-2-1-BRIDGE-ACROSS
 *
 * Periodically polls active bridge transfers and updates their status.
 * Detects timed-out transfers and marks them accordingly.
 *
 * Lifecycle:
 *   pending → relaying → confirming → completed
 *   pending → failed
 *   relaying → timed_out (when timeout_at is exceeded)
 *
 * Enabled when `BRIDGE_POLLING_ENABLED=true`.
 */
@Injectable()
export class BridgeTransferPollingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BridgeTransferPollingWorker.name);

  private pollTimer?: NodeJS.Timeout;
  private readonly pollIntervalMs: number;

  // Metrics
  private polledCounter!: Counter<string>;
  private statusTransitionCounter!: Counter<string>;
  private timeoutCounter!: Counter<string>;
  private activeTransfersGauge!: Gauge<string>;

  constructor(
    private readonly bridgeTransferService: BridgeTransferService,
    private readonly bridgeAdapterFactory: BridgeAdapterFactoryService,
  ) {
    this.pollIntervalMs = Number(process.env.BRIDGE_POLLING_INTERVAL_MS ?? DEFAULT_POLL_INTERVAL_MS);
    this.initializeMetrics();
  }

  onModuleInit(): void {
    const enabled = process.env.BRIDGE_POLLING_ENABLED === 'true';
    if (!enabled) {
      this.logger.log('Bridge transfer polling is disabled (BRIDGE_POLLING_ENABLED not set)');
      return;
    }

    this.logger.log(
      `Starting bridge transfer polling worker (interval=${this.pollIntervalMs}ms)`,
    );
    this.startPolling();
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    this.logger.log('Bridge transfer polling worker stopped');
  }

  // ─────────────────────────────────────────────────────────────────────
  // Polling logic
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Execute a single polling cycle.
   *
   * Visible for testing.
   */
  async pollOnce(): Promise<{ polled: number; timedOut: number; completed: number }> {
    const result = { polled: 0, timedOut: 0, completed: 0 };

    const activeTransfers = await this.bridgeTransferService.getActiveTransfers();

    if (activeTransfers.length === 0) {
      return result;
    }

    this.activeTransfersGauge.set(activeTransfers.length);

    for (const transfer of activeTransfers) {
      result.polled += 1;

      try {
        // 1. Check timeout
        if (transfer.timeoutAt && new Date() > transfer.timeoutAt) {
          await this.bridgeTransferService.markTimedOut(transfer.id);
          result.timedOut += 1;
          this.timeoutCounter.inc({ bridge_key: transfer.bridgeKey });
          this.logger.warn(
            `Bridge transfer ${transfer.id} timed out (bridge=${transfer.bridgeKey} ` +
            `${transfer.sourceChainId} → ${transfer.destinationChainId})`,
          );
          continue;
        }

        // 2. Resolve adapter
        let adapter;
        try {
          adapter = this.bridgeAdapterFactory.resolveAdapter(transfer.bridgeKey);
        } catch {
          this.logger.warn(
            `No adapter for bridgeKey=${transfer.bridgeKey}, skipping transfer ${transfer.id}`,
          );
          continue;
        }

        // 3. Poll and update status
        const previousStatus = transfer.status;
        const updated = await this.bridgeTransferService.pollAndUpdateStatus(transfer, adapter);

        if (updated.status !== previousStatus) {
          this.statusTransitionCounter.inc({
            bridge_key: transfer.bridgeKey,
            from: previousStatus,
            to: updated.status,
          });

          this.logger.log(
            `Bridge transfer ${transfer.id}: ${previousStatus} → ${updated.status}`,
          );

          if (updated.status === 'completed') {
            result.completed += 1;
          }
        }
      } catch (error) {
        this.logger.error(
          `Error polling bridge transfer ${transfer.id}: ${String(error)}`,
        );
        // Continue with next transfer — don't fail the entire polling cycle
      }
    }

    this.polledCounter.inc(result.polled);

    return result;
  }

  /**
   * Get the polling interval in ms (for testing).
   */
  getPollIntervalMs(): number {
    return this.pollIntervalMs;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────────────

  private startPolling(): void {
    // Use setInterval with unref to not prevent process exit
    this.pollTimer = setInterval(() => {
      void this.pollOnce().catch((err) => {
        this.logger.error(`Polling cycle error: ${String(err)}`);
      });
    }, this.pollIntervalMs);

    if (this.pollTimer.unref) {
      this.pollTimer.unref();
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Metrics
  // ─────────────────────────────────────────────────────────────────────

  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    this.polledCounter = new Counter({
      name: 'arb_bridge_polled_transfers_total',
      help: 'Total bridge transfers polled by the polling worker',
      registers: [registry],
    });

    this.statusTransitionCounter = new Counter({
      name: 'arb_bridge_status_transitions_total',
      help: 'Total bridge transfer status transitions',
      labelNames: ['bridge_key', 'from', 'to'],
      registers: [registry],
    });

    this.timeoutCounter = new Counter({
      name: 'arb_bridge_timeouts_total',
      help: 'Total bridge transfers timed out',
      labelNames: ['bridge_key'],
      registers: [registry],
    });

    this.activeTransfersGauge = new Gauge({
      name: 'arb_bridge_active_transfers',
      help: 'Current number of active bridge transfers',
      registers: [registry],
    });
  }
}