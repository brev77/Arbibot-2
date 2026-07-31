import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { ArbitrageOpportunityEntity } from '@arbibot/persistence';

import { OpportunitiesService } from './opportunities.service';

/**
 * AutoDriveWorker (opportunity-service) — drives scanner-sourced opportunities
 * through risk evaluation and paper-enqueue automatically.
 *
 * Per tick (every AUTO_DRIVE_INTERVAL_MS):
 *   1. Finds opportunities in 'detected' state with scanner payload (buyVenue)
 *   2. Filters: only netProfitUsd > 0
 *   3. Calls requestRiskEvaluation (detected → enriched → risk_checked)
 *   4. If approved → calls paperEnqueue (→ promotion candidate)
 *
 * Set AUTO_DRIVE_INTERVAL_MS=0 to disable.
 */
@Injectable()
export class AutoDriveWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoDriveWorker.name);
  private timer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    @InjectRepository(ArbitrageOpportunityEntity)
    private readonly repo: Repository<ArbitrageOpportunityEntity>,
    private readonly opportunitiesService: OpportunitiesService,
  ) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.AUTO_DRIVE_INTERVAL_MS ?? '0');
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      this.logger.log('Auto-drive disabled (AUTO_DRIVE_INTERVAL_MS unset or 0)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref?.();
    this.logger.log(`Auto-drive worker started (interval ${intervalMs}ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const pending = await this.repo.find({
        where: { state: 'detected' },
        take: 10,
        order: { createdAt: 'DESC' },
      });

      // Only drive scanner-sourced ones (payload has buyVenue)
      const scannerOpps = pending.filter((opp) => {
        const payload = opp.payload;
        return payload?.buyVenue !== undefined;
      });

      if (scannerOpps.length === 0) return;

      for (const opp of scannerOpps) {
        try {
          const payload = opp.payload;
          const netProfitUsd = (payload.netProfitUsd as number) ?? 0;
          if (netProfitUsd <= 0) continue;

          const instrumentKey = (payload.instrumentKey as string) ?? opp.id;
          const spreadBps = (payload.spreadBps as number) ?? 0;

          // Drive through risk evaluation (detected → enriched → risk_checked)
          const result = await this.opportunitiesService.requestRiskEvaluation(opp.id, {
            correlationId: randomUUID(),
            notionalUsd: 1000,
            snapshotVersion: 1,
            riskMode: 'fast',
          });

          // If risk approved → create paper promotion candidate
          if (result.riskDecisionId) {
            try {
              await this.opportunitiesService.paperEnqueue(opp.id, { instrumentKey });
            } catch {
              // paperEnqueue may fail if already enqueued — that's ok
            }
          }

          this.logger.log(
            `Auto-drive: ${opp.id.slice(0, 8)} → risk=${result.riskOutcome} net=$${netProfitUsd} spread=${spreadBps}bps`,
          );
        } catch {
          // Silently skip — will retry next tick
        }
      }
    } catch (err) {
      this.logger.error('Auto-drive tick failed', err);
    } finally {
      this.isRunning = false;
    }
  }
}
