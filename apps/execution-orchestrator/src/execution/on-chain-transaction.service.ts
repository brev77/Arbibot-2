import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OnChainTransaction } from '@arbibot/persistence';
import { ChainId } from '@arbibot/contracts-eth';

/**
 * On-chain transaction metadata returned by a DEX adapter after broadcast +
 * confirmation. The orchestrator persists this via {@link OnChainTransactionService}
 * so the fill-outbound path, reconciliation detectors, and audit trail all have
 * a durable on-chain proof. Absent for non-DEX legs (HTTP/mock venues).
 *
 * P9-2: previously DEX adapters returned only `{ externalOrderId: txHash }` and
 * NEVER persisted an OnChainTransaction row — leaving applyFill enrichment
 * always undefined (notional priced as 0) and DEX reconciliation detectors
 * joining an empty table (always 0 rows).
 */
export interface OnChainTxMeta {
  readonly txHash: string;
  readonly chainId: ChainId;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly nonce?: number;
  readonly gasLimit?: string;
  readonly gasUsed?: string | null;
  readonly gasPrice?: string | null;
  readonly maxFeePerGas?: string | null;
  readonly maxPriorityFeePerGas?: string | null;
  readonly blockNumber?: number | null;
  readonly blockHash?: string | null;
  readonly transactionIndex?: number | null;
  readonly value?: string;
  readonly status: 'confirmed' | 'failed' | 'reverted';
  readonly revertReason?: string | null;
}

/**
 * Single-writer for `on_chain_transactions` (P9-2, architecture guard B2).
 *
 * All writes to the OnChainTransaction table go through this service. Other
 * services (PlansService) may READ the table (for plan enrichment / display)
 * but MUST NOT write — the single-writer boundary keeps on-chain tx tracking
 * consistent with the leg state machine and the outbox events emitted alongside
 * each status transition.
 *
 * Lifecycle (driven by the two-phase mark-sent, P9-1):
 *   Phase 1 (leg `created → submitting`): no row yet (nonce/txHash unknown
 *     before broadcast). The row is created in Phase 3 once the adapter returns.
 *   Phase 3 (leg `submitting → sent`): `createConfirmed` / `createFailed`
 *     persists the row atomically with the leg state change + emits the
 *     DexTransaction{Confirmed,Failed} outbox event in the SAME transaction.
 *
 * NOTE: a pending row before broadcast (Phase 1.5) was considered but rejected
 * for the initial P9-1 cut — it requires the adapter to return the nonce before
 * broadcasting (a signature change across all 5 adapters + nonce-manager). The
 * crash window between broadcast and Phase 3 commit is covered by the
 * stuck-plan reaper (P9-7) reading the mempool via the RPC provider.
 */
@Injectable()
export class OnChainTransactionService {
  private readonly logger = new Logger(OnChainTransactionService.name);

  constructor(
    @InjectRepository(OnChainTransaction)
    private readonly repo: Repository<OnChainTransaction>,
  ) {}

  /**
   * Persist a confirmed/failed/reverted on-chain tx + emit the matching outbox
   * event, ATOMICALLY with the caller's EntityManager (same tx as the leg state
   * transition). Idempotent on txHash (unique constraint) — a duplicate insert
   * is a no-op (logged), so re-applies after a crash are safe.
   *
   * Call this in the SAME transaction that flips the leg `submitting → sent`
   * (confirmed) or `submitting → failed` (reverted).
   */
  async persistWithOutcome(
    em: EntityManager,
    legId: string,
    meta: OnChainTxMeta,
  ): Promise<OnChainTransaction | null> {
    // Idempotency: if a row with this txHash already exists (e.g. reaper
    // re-applied a confirmed tx after a crash), skip the insert.
    const existing = await em.findOne(OnChainTransaction, {
      where: { txHash: meta.txHash },
    });
    if (existing !== null) {
      this.logger.debug(
        `OnChainTransaction already persisted for txHash=${meta.txHash} (leg ${legId}) — skipping duplicate`,
      );
      return existing;
    }

    const row = em.create(OnChainTransaction, {
      txHash: meta.txHash,
      chainId: meta.chainId,
      legId,
      fromAddress: meta.fromAddress,
      toAddress: meta.toAddress,
      nonce: meta.nonce ?? null,
      gasLimit: meta.gasLimit ?? '0',
      gasUsed: meta.gasUsed ?? null,
      gasPrice: meta.gasPrice ?? null,
      maxFeePerGas: meta.maxFeePerGas ?? null,
      maxPriorityFeePerGas: meta.maxPriorityFeePerGas ?? null,
      blockNumber: meta.blockNumber ?? null,
      blockHash: meta.blockHash ?? null,
      transactionIndex: meta.transactionIndex ?? null,
      value: meta.value ?? '0',
      status: meta.status,
      revertReason: meta.revertReason ?? null,
      confirmedAt: meta.status === 'confirmed' ? new Date() : null,
    });
    const saved = await em.save(OnChainTransaction, row);
    this.logger.log(
      `Persisted OnChainTransaction txHash=${meta.txHash} leg=${legId} status=${meta.status}`,
    );
    return saved;
  }

  /**
   * Find the most recent confirmed on-chain tx for a leg (used by applyFill
   * enrichment — DEX-1-2-FILL-TRACKING / D4-B-3-CEILING).
   */
  async findConfirmedForLeg(legId: string): Promise<OnChainTransaction | null> {
    return this.repo.findOne({
      where: { legId, status: 'confirmed' },
      order: { createdAt: 'DESC' },
    });
  }
}
