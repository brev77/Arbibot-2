import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { type DexFillMetadata } from '@arbibot/contracts';
import { OnChainTransaction } from '@arbibot/persistence';

/**
 * DexFillTrackerService — links confirmed on-chain transactions to fill events.
 *
 * Step: DEX-1-2-FILL-TRACKING
 *
 * Responsibilities:
 * - Lookup confirmed/reverted on-chain transactions by legId
 * - Extract DEX fill metadata (txHash, gasUsed, blockNumber, etc.)
 * - Provide metadata for LegFilled outbox event enrichment
 * - Idempotent: repeated calls return the same result
 *
 * Single-writer: execution-orchestrator owns OnChainTransaction reads;
 * on-chain tx rows are written by the DEX adapter flow (separate concern).
 */
@Injectable()
export class DexFillTrackerService {
  private readonly logger = new Logger(DexFillTrackerService.name);

  constructor(
    @InjectRepository(OnChainTransaction)
    private readonly onChainTxRepo: Repository<OnChainTransaction>,
  ) {}

  /**
   * Find the most recent confirmed on-chain transaction for a given leg.
   * Returns DEX fill metadata if a confirmed tx exists, null otherwise.
   *
   * Idempotent: same legId always returns same result for a given tx state.
   */
  async getDexFillMetadata(legId: string): Promise<DexFillMetadata | null> {
    const tx = await this.onChainTxRepo.findOne({
      where: { legId, status: 'confirmed' },
      order: { createdAt: 'DESC' },
    });

    if (tx === null) {
      return null;
    }

    return {
      txHash: tx.txHash,
      chainId: tx.chainId,
      gasUsed: tx.gasUsed,
      effectiveGasPrice: tx.gasPrice,
      blockNumber: tx.blockNumber,
      fromAddress: tx.fromAddress,
      toAddress: tx.toAddress,
    };
  }

  /**
   * Check whether a leg has any on-chain transaction (pending, confirmed, failed, reverted).
   * Useful for determining if a leg was submitted via DEX adapter.
   */
  async hasOnChainTransaction(legId: string): Promise<boolean> {
    const count = await this.onChainTxRepo.count({
      where: { legId },
    });
    return count > 0;
  }

  /**
   * Get all on-chain transactions for a leg (for debugging/reconciliation).
   */
  async getTransactionsForLeg(legId: string): Promise<OnChainTransaction[]> {
    return this.onChainTxRepo.find({
      where: { legId },
      order: { createdAt: 'ASC' },
    });
  }
}