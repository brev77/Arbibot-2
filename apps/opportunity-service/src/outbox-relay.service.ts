import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, IsNull, type EntityManager } from 'typeorm';

import {
  EVENT_NAMES,
  type PaperPromotionCandidateRequestedPayloadV1,
  type RiskDecisionIssuedPayloadV1,
} from '@arbibot/contracts';
import { fetchLockedOutboxBatch, type LockedOutboxRow, tryClaimInboxMessage } from '@arbibot/messaging';
import { ArbitrageOpportunityEntity, InboxEventEntity, OutboxEventEntity } from '@arbibot/persistence';

import { PaperClientService } from './opportunities/paper-client.service';

const OPPORTUNITY_INBOX_CONSUMER_ID = 'opportunity-service';

const RELAY_OUTBOX_EVENT_TYPES = [
  EVENT_NAMES.riskDecisionIssued,
  EVENT_NAMES.paperPromotionCandidateRequested,
] as const;

/** After dispatch: whether to set processed_at on the outbox row. */
type RelayDispatchResult = 'mark_processed' | 'leave_open';

@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  /** Serializes relay ticks so two overlapping `processBatch` runs cannot double-HTTP the same row after lock release. */
  private relayGate: Promise<void> = Promise.resolve();

  constructor(
    private readonly dataSource: DataSource,
    private readonly paperClient: PaperClientService,
  ) {}

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

  /**
   * Processes up to OUTBOX_RELAY_BATCH rows (default 25).
   * Serialized via `relayGate` so paper promotion HTTP never races another tick on the same row.
   */
  async processBatch(): Promise<void> {
    this.relayGate = this.relayGate
      .catch(() => undefined)
      .then(() => this.processBatchInner());
    await this.relayGate;
  }

  private async processBatchInner(): Promise<void> {
    const maxRows = Number(process.env.OUTBOX_RELAY_BATCH ?? '25');
    for (let i = 0; i < maxRows; i += 1) {
      const step = await this.dataSource.transaction(async (em) => {
        const batch = await fetchLockedOutboxBatch(em, 1, [...RELAY_OUTBOX_EVENT_TYPES]);
        if (batch.length === 0) {
          return { kind: 'empty' } as const;
        }
        const row = batch[0]!;
        if (row.eventType === EVENT_NAMES.paperPromotionCandidateRequested) {
          const payload = parsePaperPromotionCandidateRequestedPayload(row.payload);
          if (payload === null) {
            await this.markDeadLetter(
              em,
              row.id,
              'invalid_payload:PaperPromotionCandidateRequested',
            );
            this.logger.error(
              `Outbox ${row.id}: invalid PaperPromotionCandidateRequested payload — dead-letter`,
            );
            return { kind: 'handled' } as const;
          }
          return {
            kind: 'paper_http',
            work: { rowId: row.id, payload },
          } as const;
        }
        const dispatchResult = await this.dispatchLockedRow(em, row);
        if (dispatchResult === 'mark_processed') {
          await em.update(
            OutboxEventEntity,
            { id: row.id },
            { processedAt: new Date() },
          );
        }
        return { kind: 'handled' } as const;
      });

      if (step.kind === 'empty') {
        break;
      }
      if (step.kind === 'paper_http') {
        const { rowId, payload } = step.work;
        /**
         * At-least-once: HTTP runs after the lock transaction commits. If finalize fails after a
         * successful POST, the next poll may POST again — paper-service dedupes via `enqueueIdempotencyKey`.
         */
        const ok = await this.paperClient.enqueuePromotionCandidate({
          instrumentKey: payload.instrumentKey,
          opportunityId: payload.opportunityId,
          source: payload.source,
          score: payload.score,
          driftBps: payload.driftBps,
          evidence: payload.evidence,
          enqueueIdempotencyKey: payload.enqueueIdempotencyKey,
        });
        await this.dataSource.transaction(async (em) => {
          await this.finalizePaperPromotionRelayAttempt(em, rowId, ok);
        });
      }
    }
  }

  private async finalizePaperPromotionRelayAttempt(
    em: EntityManager,
    rowId: string,
    httpOk: boolean,
  ): Promise<void> {
    if (httpOk) {
      const result = await em.update(
        OutboxEventEntity,
        {
          id: rowId,
          processedAt: IsNull(),
          relayDeadLetterAt: IsNull(),
        },
        { processedAt: new Date() },
      );
      if (result.affected === 0) {
        this.logger.warn(
          `Outbox ${rowId}: paper promotion finalize skipped — row already processed or dead-lettered`,
        );
      }
      return;
    }
    const raw: Array<{ attempts: number }> = await em.query(
      `
      UPDATE outbox_events
      SET relay_delivery_attempts = COALESCE(relay_delivery_attempts, 0) + 1
      WHERE id = $1::bigint
        AND processed_at IS NULL
        AND relay_dead_letter_at IS NULL
      RETURNING relay_delivery_attempts::int AS attempts
      `,
      [rowId],
    );
    const attempts = raw[0]?.attempts ?? 0;
    const maxAttempts = Number(
      process.env.OUTBOX_RELAY_MAX_PAPER_PROMOTION_ATTEMPTS ??
        process.env.OUTBOX_RELAY_MAX_OPPORTUNITY_ATTEMPTS ??
        '25',
    );
    if (attempts >= maxAttempts) {
      await this.markDeadLetter(
        em,
        rowId,
        `paper_promotion_http_failed:max_attempts=${maxAttempts}`,
      );
      this.logger.error(
        `Outbox ${rowId}: paper promotion delivery failed after ${maxAttempts} attempts — dead-letter`,
      );
    } else {
      this.logger.warn(
        `Outbox ${rowId}: paper promotion POST failed, attempt ${attempts}/${maxAttempts}`,
      );
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

function parsePaperPromotionCandidateRequestedPayload(
  payload: Record<string, unknown>,
): PaperPromotionCandidateRequestedPayloadV1 | null {
  const opportunityId = payload.opportunityId;
  const instrumentKey = payload.instrumentKey;
  const source = payload.source;
  const enqueueIdempotencyKey = payload.enqueueIdempotencyKey;
  const evidence = payload.evidence;
  if (typeof opportunityId !== 'string' || opportunityId.length === 0) {
    return null;
  }
  if (typeof instrumentKey !== 'string' || instrumentKey.length === 0) {
    return null;
  }
  if (typeof source !== 'string' || source.length === 0) {
    return null;
  }
  if (typeof enqueueIdempotencyKey !== 'string' || enqueueIdempotencyKey.length === 0) {
    return null;
  }
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return null;
  }
  const score = payload.score;
  const driftBps = payload.driftBps;
  return {
    opportunityId,
    instrumentKey,
    source,
    enqueueIdempotencyKey,
    evidence: evidence as Record<string, unknown>,
    ...(typeof score === 'number' ? { score } : {}),
    ...(typeof driftBps === 'number' ? { driftBps } : {}),
  };
}
