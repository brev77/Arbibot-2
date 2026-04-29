import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * On-chain transaction tracking entity
 * Step: DEX-1-0-MIGRATIONS
 * 
 * Tracks all on-chain transactions submitted by the system
 */
@Entity({ name: 'on_chain_transactions' })
@Index('idx_on_chain_transactions_tx_hash', ['txHash'])
@Index('idx_on_chain_transactions_chain_id', ['chainId'])
@Index('idx_on_chain_transactions_leg_id', ['legId'])
@Index('idx_on_chain_transactions_status', ['status'])
@Index('idx_on_chain_transactions_created_at', ['createdAt'])
@Index('idx_on_chain_transactions_from_address', ['fromAddress'])
@Index('idx_on_chain_transactions_to_address', ['toAddress'])
export class OnChainTransaction {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ name: 'tx_hash', type: 'varchar', length: 66, unique: true })
  txHash!: string;

  @Column({ name: 'chain_id', type: 'integer' })
  chainId!: number;

  @Column({ name: 'leg_id', type: 'bigint', nullable: true })
  legId!: number | null;

  @Column({ name: 'from_address', type: 'varchar', length: 42 })
  fromAddress!: string;

  @Column({ name: 'to_address', type: 'varchar', length: 42 })
  toAddress!: string;

  @Column({ type: 'numeric', precision: 78, scale: 0, default: 0 })
  value!: string;

  @Column({ name: 'gas_limit', type: 'numeric', precision: 78, scale: 0 })
  gasLimit!: string;

  @Column({ name: 'gas_used', type: 'numeric', precision: 78, scale: 0, nullable: true })
  gasUsed!: string | null;

  @Column({ name: 'gas_price', type: 'numeric', precision: 78, scale: 0, nullable: true })
  gasPrice!: string | null;

  @Column({ name: 'max_priority_fee_per_gas', type: 'numeric', precision: 78, scale: 0, nullable: true })
  maxPriorityFeePerGas!: string | null;

  @Column({ name: 'max_fee_per_gas', type: 'numeric', precision: 78, scale: 0, nullable: true })
  maxFeePerGas!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: 'pending' | 'confirmed' | 'failed' | 'reverted';

  @Column({ name: 'block_number', type: 'bigint', nullable: true })
  blockNumber!: number | null;

  @Column({ name: 'block_hash', type: 'varchar', length: 66, nullable: true })
  blockHash!: string | null;

  @Column({ name: 'transaction_index', type: 'integer', nullable: true })
  transactionIndex!: number | null;

  @Column({ default: 0 })
  confirmations!: number;

  @Column({ name: 'confirmed_at', type: 'timestamp with time zone', nullable: true })
  confirmedAt!: Date | null;

  @Column({ name: 'revert_reason', type: 'text', nullable: true })
  revertReason!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'bigint', nullable: true })
  nonce!: number | null;

  @Column({ name: 'input_data', type: 'bytea', nullable: true })
  inputData!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}