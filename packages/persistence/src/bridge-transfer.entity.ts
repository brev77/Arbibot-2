import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ExecutionLegEntity } from './execution-leg.entity';

/**
 * Bridge transfer tracking entity.
 *
 * Step: DEX-2-1-BRIDGE-ACROSS
 *
 * Tracks cross-chain bridge transfers from submission to completion.
 * Single-writer: execution-orchestrator.
 *
 * Status lifecycle:
 *   pending → relaying → confirming → completed
 *   pending → failed
 *   relaying → timed_out → failed (give up) or retry (operator approval)
 */
@Entity({ name: 'bridge_transfers' })
@Index('idx_bridge_transfers_leg_id', ['legId'])
@Index('idx_bridge_transfers_status', ['status'])
@Index('idx_bridge_transfers_source_tx', ['sourceTxHash'])
@Index('idx_bridge_transfers_destination_tx', ['destinationTxHash'])
@Index('idx_bridge_transfers_idempotency', ['idempotencyKey'], { unique: true })
export class BridgeTransferEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'leg_id', type: 'uuid' })
  legId!: string;

  @ManyToOne(() => ExecutionLegEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'leg_id' })
  leg!: ExecutionLegEntity;

  @Column({ name: 'bridge_key', type: 'text' })
  bridgeKey!: string;

  @Column({ name: 'source_chain_id', type: 'integer' })
  sourceChainId!: number;

  @Column({ name: 'destination_chain_id', type: 'integer' })
  destinationChainId!: number;

  @Column({ name: 'source_tx_hash', type: 'varchar', length: 66, nullable: true })
  sourceTxHash!: string | null;

  @Column({ name: 'destination_tx_hash', type: 'varchar', length: 66, nullable: true })
  destinationTxHash!: string | null;

  @Column({ name: 'bridge_id', type: 'text', nullable: true })
  bridgeId!: string | null;

  @Column({ name: 'token_address', type: 'varchar', length: 42 })
  tokenAddress!: string;

  @Column({ name: 'destination_token_address', type: 'varchar', length: 42 })
  destinationTokenAddress!: string;

  @Column({ type: 'numeric', precision: 78, scale: 0 })
  amount!: string;

  @Column({ type: 'text', default: 'pending' })
  status!: 'pending' | 'relaying' | 'confirming' | 'completed' | 'failed' | 'timed_out';

  @Column({ name: 'estimated_relay_ms', type: 'bigint', nullable: true })
  estimatedRelayMs!: number | null;

  @Column({ name: 'actual_relay_ms', type: 'bigint', nullable: true })
  actualRelayMs!: number | null;

  @Column({ name: 'idempotency_key', type: 'text', unique: true })
  idempotencyKey!: string;

  // ── Finality tracking (D4-B-5-BRIDGE, L5) ──────────────────────────────
  /** Confirmations observed on the source chain TX. Updated by pollAndUpdateStatus. */
  @Column({ name: 'source_confirmations', type: 'integer', default: 0 })
  sourceConfirmations!: number;

  /** Chain-specific required confirmations snapshotted at submit. */
  @Column({ name: 'required_confirmations', type: 'integer', default: 0 })
  requiredConfirmations!: number;

  /** Confirmations observed on the destination chain fill TX (0 until delivery verified). */
  @Column({ name: 'destination_confirmations', type: 'integer', default: 0 })
  destinationConfirmations!: number;

  /** Timestamp when destination delivery was proven on-chain (completed). */
  @Column({ name: 'finalized_at', type: 'timestamptz', nullable: true })
  finalizedAt!: Date | null;
  // ────────────────────────────────────────────────────────────────────────

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt!: Date | null;

  @Column({ name: 'failed_at', type: 'timestamptz', nullable: true })
  failedAt!: Date | null;

  @Column({ name: 'timeout_at', type: 'timestamptz', nullable: true })
  timeoutAt!: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}