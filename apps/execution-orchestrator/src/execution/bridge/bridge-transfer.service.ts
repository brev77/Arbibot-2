import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, type QueryDeepPartialEntity } from 'typeorm';
import { BridgeTransferEntity } from '@arbibot/persistence';

import type { BridgeAdapter, BridgeTransferParams } from './bridge-adapter.interface';

/**
 * Bridge transfer lifecycle service.
 *
 * Step: DEX-2-1-BRIDGE-ACROSS
 *
 * Manages bridge transfer records in `bridge_transfers` table.
 * Single-writer: execution-orchestrator.
 *
 * Responsibilities:
 * - Idempotent bridge transfer submission
 * - Status tracking and polling
 * - Timeout detection
 * - Fill commitment
 */
@Injectable()
export class BridgeTransferService {
  private readonly logger = new Logger(BridgeTransferService.name);

  constructor(
    @InjectRepository(BridgeTransferEntity)
    private readonly bridgeTransferRepo: Repository<BridgeTransferEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Submit a bridge transfer with idempotency.
   *
   * Flow:
   * 1. Generate deterministic idempotency key
   * 2. Check for existing record with same key
   * 3. If active record exists → return existing
   * 4. If failed/timed_out record exists → reject (operator must approve retry)
   * 5. Submit via adapter and insert new record
   */
  async submitBridgeTransfer(
    adapter: BridgeAdapter,
    params: BridgeTransferParams,
    legId: string,
  ): Promise<BridgeTransferEntity> {
    // Check for existing record
    const existing = await this.bridgeTransferRepo.findOne({
      where: { idempotencyKey: params.idempotencyKey },
    });

    if (existing) {
      if (['pending', 'relaying', 'confirming'].includes(existing.status)) {
        this.logger.log(
          `submitBridgeTransfer: returning existing active transfer ${existing.id} ` +
          `status=${existing.status}`,
        );
        return existing;
      }

      if (['failed', 'timed_out'].includes(existing.status)) {
        throw new Error(
          `Bridge transfer ${existing.id} is in terminal state ${existing.status}. ` +
          `Operator approval required for retry.`,
        );
      }

      // completed — should not happen for same idempotency key
      return existing;
    }

    // Submit via adapter
    const result = await adapter.submitBridgeTransfer(params);

    // Persist record
    const entity = this.bridgeTransferRepo.create({
      legId,
      bridgeKey: adapter.bridgeKey,
      sourceChainId: params.sourceChainId,
      destinationChainId: params.destinationChainId,
      sourceTxHash: result.sourceTxHash,
      bridgeId: result.bridgeId,
      tokenAddress: params.token,
      destinationTokenAddress: params.destinationToken,
      amount: params.amount.toString(),
      status: 'pending',
      estimatedRelayMs: result.estimatedRelayMs,
      idempotencyKey: params.idempotencyKey,
      submittedAt: new Date(),
      timeoutAt: new Date(Date.now() + result.estimatedRelayMs * 2), // 2x estimated relay
    });

    const saved = await this.bridgeTransferRepo.save(entity);

    this.logger.log(
      `submitBridgeTransfer: created transfer ${saved.id} bridge=${adapter.bridgeKey} ` +
      `${params.sourceChainId} → ${params.destinationChainId}`,
    );

    return saved;
  }

  /**
   * Get bridge transfer by ID.
   */
  async getById(id: string): Promise<BridgeTransferEntity | null> {
    return this.bridgeTransferRepo.findOne({ where: { id } });
  }

  /**
   * Get bridge transfer by leg ID.
   */
  async getByLegId(legId: string): Promise<BridgeTransferEntity | null> {
    return this.bridgeTransferRepo.findOne({ where: { legId } });
  }

  /**
   * Poll bridge status via adapter and update entity.
   *
   * Returns updated entity. Transitions:
   *   pending → relaying → confirming → completed
   *   pending → failed
   *   relaying → timed_out
   */
  async pollAndUpdateStatus(
    entity: BridgeTransferEntity,
    adapter: BridgeAdapter,
  ): Promise<BridgeTransferEntity> {
    if (!entity.bridgeId) {
      this.logger.warn(`pollAndUpdateStatus: no bridgeId for transfer ${entity.id}`);
      return entity;
    }

    const statusResult = await adapter.checkBridgeStatus(entity.bridgeId);

    // Map adapter status to entity status
    const statusMap: Record<string, BridgeTransferEntity['status']> = {
      pending: 'pending',
      relaying: 'relaying',
      confirming: 'confirming',
      completed: 'completed',
      failed: 'failed',
    };

    const newStatus = statusMap[statusResult.status];
    if (!newStatus || newStatus === entity.status) {
      return entity;
    }

    const updates: QueryDeepPartialEntity<BridgeTransferEntity> = {
      status: newStatus,
      updatedAt: new Date(),
    };

    if (statusResult.destinationTxHash) {
      updates.destinationTxHash = statusResult.destinationTxHash;
    }

    if (newStatus === 'completed') {
      updates.confirmedAt = new Date();
      if (entity.submittedAt) {
        updates.actualRelayMs = Date.now() - entity.submittedAt.getTime();
      }
    }

    if (newStatus === 'failed') {
      updates.failedAt = new Date();
    }

    await this.bridgeTransferRepo.update(entity.id, updates);

    this.logger.log(
      `pollAndUpdateStatus: transfer ${entity.id} ${entity.status} → ${newStatus}`,
    );

    const updated = await this.bridgeTransferRepo.findOne({ where: { id: entity.id } });
    return updated ?? { ...entity, status: newStatus };
  }

  /**
   * Mark transfer as timed out.
   */
  async markTimedOut(id: string): Promise<BridgeTransferEntity> {
    await this.bridgeTransferRepo.update(id, {
      status: 'timed_out',
      failedAt: new Date(),
      updatedAt: new Date(),
    });

    this.logger.warn(`markTimedOut: transfer ${id} timed out`);

    const entity = await this.bridgeTransferRepo.findOne({ where: { id } });
    if (!entity) {
      throw new Error(`Bridge transfer ${id} not found after timeout update`);
    }
    return entity;
  }

  /**
   * Get all pending/relaying transfers (for timeout worker).
   */
  async getActiveTransfers(): Promise<BridgeTransferEntity[]> {
    return this.bridgeTransferRepo.find({
      where: [
        { status: 'pending' },
        { status: 'relaying' },
        { status: 'confirming' },
      ],
    });
  }

  /**
   * Generate deterministic idempotency key.
   *
   * Format: `{planId}:{legIndex}:{bridgeKey}`
   */
  static generateIdempotencyKey(
    planId: string,
    legIndex: number,
    bridgeKey: string,
  ): string {
    return `${planId}:${legIndex}:${bridgeKey}`;
  }
}