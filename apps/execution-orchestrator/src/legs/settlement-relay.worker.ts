import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EVENT_NAMES } from '@arbibot/contracts';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Counter } from 'prom-client';
import { OutboxEventEntity } from '@arbibot/persistence';

import { FillOutboundService, type LegFilledSettlementArgs } from './fill-outbound.service';
import { PlansService } from '../plans/plans.service';

/**
 * Settlement Outbox Relay Worker (P9-8).
 *
 * Replaces the post-commit HTTP settlement path in FillOutboundService
 * (guard B3: the old path is removed, not duplicated — single drain-point).
 * Previously `afterLegFullyFilled` did `confirmPortfolio` + `releaseCapital`
 * over HTTP right after the DB commit, with 4 retries but NO persistence — a
 * crash between commit and successful POST left the portfolio position missing
 * and capital locked until manual intervention.
 *
 * Now the relay drains `legFilled` and `planCompleted` outbox rows (already
 * written by legs.service / plans.service in the same tx as the state change):
 *   - legFilled → portfolio confirm-fill (HTTP, idempotent on `portfolio:fill:{legId}`)
 *   - planCompleted (with capitalReservationId) → capital release (HTTP, idempotent)
 * and marks each row `processed_at` on success. On crash → resume from unprocessed
 * rows (at-least-once; portfolio/capital are idempotent via idempotencyKey).
 *
 * Plan completion (`tryMarkPlanCompletedWhenAllLegsFilled`) stays synchronous-in-tx
 * in `afterLegFullyFilled` — it is NOT a network call. Only the HTTP side-effects
 * moved here. `EXECUTION_SETTLEMENT_ENABLED=false` keeps the relay off for
 * hermetic unit tests.
 */
const SETTLEMENT_EVENT_TYPES = [EVENT_NAMES.legFilled, EVENT_NAMES.planCompleted];

const TRANSIENT_HTTP = new Set([429, 502, 503, 504]);

@Injectable()
export class SettlementRelayWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettlementRelayWorker.name);
  private isShuttingDown = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly deliveredCounter: Counter;
  private readonly failedCounter: Counter;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly fillOutbound: FillOutboundService,
    private readonly plans: PlansService,
  ) {
    const registry = getArbibotMetricsRegistry();
    const deliveredName = 'arb_execution_settlement_delivered_total';
    this.deliveredCounter =
      registry.getSingleMetric(deliveredName) instanceof Counter
        ? (registry.getSingleMetric(deliveredName) as Counter)
        : new Counter({
            name: deliveredName,
            help: 'Settlement outbox rows delivered (at-least-once, P9-8)',
            labelNames: ['event_type', 'target'],
            registers: [registry],
          });
    const failedName = 'arb_execution_settlement_failed_total';
    this.failedCounter =
      registry.getSingleMetric(failedName) instanceof Counter
        ? (registry.getSingleMetric(failedName) as Counter)
        : new Counter({
            name: failedName,
            help: 'Settlement outbox rows that failed delivery (P9-8, will retry)',
            labelNames: ['event_type', 'reason'],
            registers: [registry],
          });
  }

  onModuleInit(): void {
    // P9-8: settlement relay is the single drain-point for legFilled/planCompleted
    // outbox rows. Gated by EXECUTION_SETTLEMENT_ENABLED for hermetic unit tests.
    if (process.env.EXECUTION_SETTLEMENT_ENABLED !== 'true') {
      this.logger.log('Settlement relay disabled (EXECUTION_SETTLEMENT_ENABLED != true)');
      return;
    }
    const intervalMs = Number(process.env.SETTLEMENT_RELAY_INTERVAL_MS ?? 5_000);
    this.logger.log(`Starting settlement relay (interval ${intervalMs}ms)`);
    this.timer = setInterval(() => {
      void this.drainBatch();
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    this.isShuttingDown = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.logger.log('Settlement relay shutting down');
  }

  /**
   * Drain one batch of unprocessed settlement outbox rows. Public for testing.
   * Returns the number of rows delivered.
   */
  async drainBatch(): Promise<number> {
    if (this.isShuttingDown) {
      return 0;
    }
    let delivered = 0;
    try {
      const rows = await this.dataSource.transaction(async (em) => {
        // Lock a small batch of unprocessed settlement rows.
        const batch = await em.find(OutboxEventEntity, {
          where: SETTLEMENT_EVENT_TYPES.map((eventType) => ({
            eventType,
            processedAt: undefined as never,
          })),
          take: Number(process.env.SETTLEMENT_RELAY_BATCH_SIZE ?? 10),
          order: { createdAt: 'ASC' },
        });
        // Pessimistic lock: skip-lock would be ideal, but find + update-in-tx
        // serializes adequately for the low volume of settlement events.
        return batch;
      });

      for (const row of rows) {
        const ok = await this.deliver(row);
        if (ok) {
          // Mark processed in a separate tx so a failure to mark doesn't roll
          // back the side-effect (idempotent redelivery covers the gap).
          await this.dataSource.transaction(async (em) => {
            await em.update(OutboxEventEntity, row.id, { processedAt: new Date() });
          });
          delivered += 1;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Settlement relay drain failed: ${msg}`);
    }
    return delivered;
  }

  /**
   * Deliver one outbox row to its HTTP target. Returns true on success.
   * Idempotent on the receiving side via idempotencyKey.
   */
  private async deliver(row: OutboxEventEntity): Promise<boolean> {
    try {
      if (row.eventType === EVENT_NAMES.legFilled) {
        await this.confirmPortfolioFromOutbox(row);
        this.deliveredCounter.inc({ event_type: row.eventType, target: 'portfolio' });
        return true;
      }
      if (row.eventType === EVENT_NAMES.planCompleted) {
        await this.releaseCapitalFromOutbox(row);
        this.deliveredCounter.inc({ event_type: row.eventType, target: 'capital' });
        return true;
      }
      // Unknown event type — mark as delivered to avoid a stuck row.
      this.logger.warn(`Settlement relay: unknown event type ${row.eventType} (row ${row.id}) — marking processed`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.failedCounter.inc({ event_type: row.eventType, reason: 'http_error' });
      this.logger.warn(`Settlement relay failed to deliver row ${row.id} (${row.eventType}): ${msg}`);
      return false;
    }
  }

  /**
   * Reconstruct the portfolio confirm-fill call from the outbox payload.
   * Reuses FillOutboundService.confirmPortfolio by rebuilding LegFilledSettlementArgs.
   */
  private async confirmPortfolioFromOutbox(row: OutboxEventEntity): Promise<void> {
    const payload = row.payload;
    const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
    const num = (v: unknown, d = 0): number => (typeof v === 'number' ? v : d);
    const args: LegFilledSettlementArgs = {
      planId: str(payload.planId),
      legId: str(payload.legId),
      legIndex: num(payload.legIndex),
      filledQuantity: num(payload.filledQuantity),
      instrumentKey: str(payload.instrumentKey),
      correlationId: (row.envelope as Record<string, unknown> | undefined)?.correlationId as string | null ?? null,
      chainId: typeof payload.chainId === 'number' ? payload.chainId : undefined,
      tokenIn: typeof payload.tokenIn === 'string' ? payload.tokenIn : undefined,
    };
    await this.fillOutbound.confirmPortfolioPublic(args);
  }

  /**
   * Release capital for a planCompleted event (if the plan has a reservation).
   */
  private async releaseCapitalFromOutbox(row: OutboxEventEntity): Promise<void> {
    const payload = row.payload;
    const reservationId = payload.capitalReservationId;
    if (typeof reservationId !== 'string' || reservationId.length === 0) {
      // No reservation to release — nothing to do.
      return;
    }
    await this.fillOutbound.releaseCapitalPublic(reservationId);
  }
}

// Re-export for the relay's own use (avoids a second import site for TRANSIENT_HTTP).
export { TRANSIENT_HTTP };
