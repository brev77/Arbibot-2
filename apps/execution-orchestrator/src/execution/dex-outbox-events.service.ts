import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import {
  DEX_TRANSACTION_PAYLOAD_SCHEMA_VERSION,
  EVENT_NAMES,
  SERVICE_IDS,
  type DexTransactionConfirmedPayloadV1,
  type DexTransactionFailedPayloadV1,
  type DexTransactionSubmittedPayloadV1,
} from '@arbibot/contracts';
import {
  OnChainTransaction,
  OutboxEventEntity,
} from '@arbibot/persistence';

/**
 * DexOutboxEventsService — writes DEX transaction lifecycle events to the outbox.
 *
 * Step: DEX-1-2-OUTBOX-EVENTS
 *
 * Responsibilities:
 * - Write DexTransactionSubmitted when an on-chain tx is submitted (pending)
 * - Write DexTransactionConfirmed when an on-chain tx is confirmed
 * - Write DexTransactionFailed when an on-chain tx fails or reverts
 * - Idempotent: skips if an outbox row with the same txHash + eventType already exists
 *
 * Single-writer: execution-orchestrator owns OnChainTransaction and these outbox events.
 *
 * Usage: callers pass an EntityManager (usually from a transaction) so the outbox
 * row is committed atomically with the status change on OnChainTransaction.
 */
@Injectable()
export class DexOutboxEventsService {
  private readonly logger = new Logger(DexOutboxEventsService.name);

  constructor(
    @InjectRepository(OnChainTransaction)
    private readonly onChainTxRepo: Repository<OnChainTransaction>,
  ) {}

  /**
   * Emit a DexTransactionSubmitted event for a newly submitted on-chain tx.
   * Should be called in the same transaction that creates the OnChainTransaction row.
   */
  async emitSubmitted(
    em: EntityManager,
    tx: OnChainTransaction,
    correlationId: string,
  ): Promise<void> {
    await this.writeOutboxRow(
      em,
      tx,
      EVENT_NAMES.dexTransactionSubmitted,
      this.buildSubmittedPayload(tx),
      correlationId,
    );
  }

  /**
   * Emit a DexTransactionConfirmed event for a confirmed on-chain tx.
   * Should be called in the same transaction that updates status to 'confirmed'.
   */
  async emitConfirmed(
    em: EntityManager,
    tx: OnChainTransaction,
    correlationId: string,
  ): Promise<void> {
    await this.writeOutboxRow(
      em,
      tx,
      EVENT_NAMES.dexTransactionConfirmed,
      this.buildConfirmedPayload(tx),
      correlationId,
    );
  }

  /**
   * Emit a DexTransactionFailed event for a failed/reverted on-chain tx.
   * Should be called in the same transaction that updates status to 'failed' or 'reverted'.
   */
  async emitFailed(
    em: EntityManager,
    tx: OnChainTransaction,
    correlationId: string,
  ): Promise<void> {
    await this.writeOutboxRow(
      em,
      tx,
      EVENT_NAMES.dexTransactionFailed,
      this.buildFailedPayload(tx),
      correlationId,
    );
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Write a single outbox row. Idempotent: if a row with the same
   * (entityId, eventType) already exists and is unprocessed, skip silently.
   */
  private async writeOutboxRow(
    em: EntityManager,
    tx: OnChainTransaction,
    eventType: string,
    payload: Record<string, unknown>,
    correlationId: string,
  ): Promise<void> {
    // Idempotency guard: skip if we already wrote this exact event
    const existing = await em.count(OutboxEventEntity, {
      where: {
        eventType,
        entityId: tx.txHash,
      },
    });
    if (existing > 0) {
      this.logger.debug(
        `Skipping duplicate outbox event ${eventType} for txHash=${tx.txHash}`,
      );
      return;
    }

    const messageId = randomUUID();
    const now = new Date();
    const entityType = 'OnChainTransaction';

    const envelope: Record<string, unknown> = {
      messageId,
      correlationId,
      causationId: tx.legId ?? messageId,
      entityType,
      entityId: tx.txHash,
      version: DEX_TRANSACTION_PAYLOAD_SCHEMA_VERSION,
      sourceModule: SERVICE_IDS.executionOrchestrator,
      eventTs: now.toISOString(),
      eventName: eventType,
      payload,
    };

    const outbox = em.create(OutboxEventEntity, {
      messageId,
      eventType,
      entityType,
      entityId: tx.txHash,
      schemaVersion: DEX_TRANSACTION_PAYLOAD_SCHEMA_VERSION,
      payload,
      envelope,
      processedAt: null,
    });

    await em.save(OutboxEventEntity, outbox);
    this.logger.log(
      `Wrote outbox event ${eventType} for txHash=${tx.txHash} (messageId=${messageId})`,
    );
  }

  private buildSubmittedPayload(
    tx: OnChainTransaction,
  ): DexTransactionSubmittedPayloadV1 {
    return {
      txHash: tx.txHash,
      chainId: tx.chainId,
      legId: tx.legId,
      planId: null, // PlanId resolved at call site if needed
      fromAddress: tx.fromAddress,
      toAddress: tx.toAddress,
      value: tx.value,
      gasLimit: tx.gasLimit,
      nonce: tx.nonce,
      submittedAt: tx.createdAt.toISOString(),
    };
  }

  private buildConfirmedPayload(
    tx: OnChainTransaction,
  ): DexTransactionConfirmedPayloadV1 {
    return {
      txHash: tx.txHash,
      chainId: tx.chainId,
      legId: tx.legId,
      planId: null,
      blockNumber: tx.blockNumber,
      gasUsed: tx.gasUsed,
      effectiveGasPrice: tx.gasPrice,
      confirmations: tx.confirmations,
      confirmedAt: tx.confirmedAt?.toISOString() ?? new Date().toISOString(),
    };
  }

  private buildFailedPayload(
    tx: OnChainTransaction,
  ): DexTransactionFailedPayloadV1 {
    return {
      txHash: tx.txHash,
      chainId: tx.chainId,
      legId: tx.legId,
      planId: null,
      blockNumber: tx.blockNumber,
      gasUsed: tx.gasUsed,
      effectiveGasPrice: tx.gasPrice,
      revertReason: tx.revertReason,
      errorMessage: tx.errorMessage,
      failedAt: new Date().toISOString(),
    };
  }
}