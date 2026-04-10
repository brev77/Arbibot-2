import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import {
  EVENT_NAMES,
  type RiskDecisionIssuedPayloadV1,
} from '@arbibot/contracts';
import { fetchLockedOutboxBatch, type LockedOutboxRow, tryClaimInboxMessage } from '@arbibot/messaging';
import { ArbitrageOpportunityEntity, InboxEventEntity, OutboxEventEntity } from '@arbibot/persistence';

const OPPORTUNITY_INBOX_CONSUMER_ID = 'opportunity-service';

/** After dispatch: whether to set processed_at on the outbox row. */
type RelayDispatchResult = 'mark_processed' | 'leave_open';

@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    const enabled = process.env.OUTBOX_RELAY_ENABLED !== 'false';
    if (!enabled) {
      this.logger.log('Outbox relay disabled (OUTBOX_RELAY_ENABLED=false)');
      return;
    }
    const ms = Number(process.env.OUTBOX_RELAY_POLL_MS ?? '2000');
    this.timer = setInterval(() => {
      void this.processBatch().catch((err: unknown) => {
        this.logger.error(err instanceof Error ? err.stack : String(err));
      });
    }, ms);
    void this.processBatch().catch((err: unknown) => {
      this.logger.error(err instanceof Error ? err.stack : String(err));
    });
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }
  }

  /** Processes up to OUTBOX_RELAY_BATCH rows (default 25), one DB transaction per row. */
  async processBatch(): Promise<void> {
    const maxRows = Number(process.env.OUTBOX_RELAY_BATCH ?? '25');
    for (let i = 0; i < maxRows; i += 1) {
      const more = await this.dataSource.transaction(async (em) => {
        const batch = await fetchLockedOutboxBatch(em, 1, [
          EVENT_NAMES.riskDecisionIssued,
        ]);
        if (batch.length === 0) {
          return false;
        }
        const row = batch[0]!;
        const dispatchResult = await this.dispatchLockedRow(em, row);
        if (dispatchResult === 'mark_processed') {
          await em.update(
            OutboxEventEntity,
            { id: row.id },
            { processedAt: new Date() },
          );
        }
        return true;
      });
      if (!more) {
        break;
      }
    }
  }

  private async dispatchLockedRow(
    em: EntityManager,
    row: LockedOutboxRow,
  ): Promise<RelayDispatchResult> {
    if (row.eventType !== EVENT_NAMES.riskDecisionIssued) {
      await this.markDeadLetter(
        em,
        row.id,
        `unsupported_event_type:${row.eventType}`,
      );
      this.logger.error(
        `Outbox ${row.id}: unsupported event_type=${row.eventType} — dead-letter (no processed_at)`,
      );
      return 'leave_open';
    }

    const payload = parseRiskDecisionIssuedPayload(row.payload);
    if (payload === null) {
      await this.markDeadLetter(em, row.id, 'invalid_payload:RiskDecisionIssued');
      this.logger.error(`Outbox ${row.id}: invalid RiskDecisionIssued payload — dead-letter`);
      return 'leave_open';
    }

    const opportunityId = payload.planReference;
    const claimed = await tryClaimInboxMessage(
      em,
      OPPORTUNITY_INBOX_CONSUMER_ID,
      row.messageId,
    );

    if (!claimed) {
      return this.finishDuplicateInboxDelivery(em, row, payload);
    }

    const opp = await em.findOne(ArbitrageOpportunityEntity, {
      where: { id: opportunityId },
      lock: { mode: 'pessimistic_write' },
    });

    if (opp === null) {
      await this.releaseInboxClaim(em, row.messageId);
      const maxAttempts = Number(process.env.OUTBOX_RELAY_MAX_OPPORTUNITY_ATTEMPTS ?? '25');
      const attempts = row.relayDeliveryAttempts + 1;
      await em.update(
        OutboxEventEntity,
        { id: row.id },
        { relayDeliveryAttempts: attempts },
      );
      if (attempts >= maxAttempts) {
        await this.markDeadLetter(
          em,
          row.id,
          `opportunity_not_found:planReference=${opportunityId}:max_attempts=${maxAttempts}`,
        );
        this.logger.error(
          `Outbox ${row.id}: opportunity ${opportunityId} missing after ${maxAttempts} attempts — dead-letter`,
        );
      } else {
        this.logger.warn(
          `Outbox ${row.id}: opportunity ${opportunityId} not found, attempt ${attempts}/${maxAttempts} — will retry`,
        );
      }
      return 'leave_open';
    }

    if (
      opp.state === 'risk_checked' &&
      opp.riskDecisionId === payload.decisionId
    ) {
      return 'mark_processed';
    }
    opp.state = 'risk_checked';
    opp.riskDecisionId = payload.decisionId;
    opp.entityVersion += 1;
    await em.save(ArbitrageOpportunityEntity, opp);
    return 'mark_processed';
  }

  /**
   * Inbox row already exists: idempotent completion if domain matches, else dead-letter.
   */
  private async finishDuplicateInboxDelivery(
    em: EntityManager,
    row: LockedOutboxRow,
    payload: RiskDecisionIssuedPayloadV1,
  ): Promise<RelayDispatchResult> {
    const opportunityId = payload.planReference;
    const opp = await em.findOne(ArbitrageOpportunityEntity, {
      where: { id: opportunityId },
      lock: { mode: 'pessimistic_write' },
    });
    if (opp === null) {
      const maxAttempts = Number(process.env.OUTBOX_RELAY_MAX_OPPORTUNITY_ATTEMPTS ?? '25');
      const attempts = row.relayDeliveryAttempts + 1;
      await em.update(
        OutboxEventEntity,
        { id: row.id },
        { relayDeliveryAttempts: attempts },
      );
      if (attempts >= maxAttempts) {
        await this.markDeadLetter(
          em,
          row.id,
          `duplicate_inbox_opportunity_missing:${opportunityId}:max_attempts=${maxAttempts}`,
        );
        this.logger.error(
          `Outbox ${row.id}: duplicate inbox but opportunity ${opportunityId} still missing after ${maxAttempts} attempts — dead-letter`,
        );
      } else {
        this.logger.warn(
          `Outbox ${row.id}: duplicate inbox, opportunity ${opportunityId} missing, attempt ${attempts}/${maxAttempts}`,
        );
      }
      return 'leave_open';
    }
    if (
      opp.state === 'risk_checked' &&
      opp.riskDecisionId === payload.decisionId
    ) {
      return 'mark_processed';
    }
    await this.markDeadLetter(
      em,
      row.id,
      `duplicate_inbox_domain_mismatch:opportunity=${opportunityId}:expectedDecision=${payload.decisionId}:state=${opp.state}`,
    );
    this.logger.error(
      `Outbox ${row.id}: duplicate inbox but opportunity state does not match decision — dead-letter`,
    );
    return 'leave_open';
  }

  private async markDeadLetter(
    em: EntityManager,
    outboxId: string,
    reason: string,
  ): Promise<void> {
    await em.update(
      OutboxEventEntity,
      { id: outboxId },
      {
        relayDeadLetterAt: new Date(),
        relayDeadLetterReason: reason.slice(0, 4000),
      },
    );
  }

  private async releaseInboxClaim(em: EntityManager, messageId: string): Promise<void> {
    await em
      .createQueryBuilder()
      .delete()
      .from(InboxEventEntity)
      .where('consumer_id = :consumerId AND message_id = :messageId', {
        consumerId: OPPORTUNITY_INBOX_CONSUMER_ID,
        messageId,
      })
      .execute();
  }
}

function parseRiskDecisionIssuedPayload(
  payload: Record<string, unknown>,
): RiskDecisionIssuedPayloadV1 | null {
  const decisionId = payload.decisionId;
  const planReference = payload.planReference;
  if (typeof decisionId !== 'string' || decisionId.length === 0) {
    return null;
  }
  if (typeof planReference !== 'string' || planReference.length === 0) {
    return null;
  }
  return payload as unknown as RiskDecisionIssuedPayloadV1;
}
