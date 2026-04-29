import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Token approval entity
 * Step: DEX-1-0-MIGRATIONS
 * 
 * Tracks token approvals for DEX spending
 */
@Entity({ name: 'approvals' })
@Index('idx_approvals_wallet_address', ['walletAddress'])
@Index('idx_approvals_chain_id', ['chainId'])
@Index('idx_approvals_token_address', ['tokenAddress'])
@Index('idx_approvals_spender_address', ['spenderAddress'])
@Index('idx_approvals_status', ['status'])
@Index('idx_approvals_tx_hash', ['txHash'])
@Index('idx_approvals_expires_at', ['expiresAt'])
export class Approval {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ name: 'wallet_address', type: 'varchar', length: 42 })
  walletAddress!: string;

  @Column({ name: 'chain_id', type: 'integer' })
  chainId!: number;

  @Column({ name: 'token_address', type: 'varchar', length: 42 })
  tokenAddress!: string;

  @Column({ name: 'spender_address', type: 'varchar', length: 42 })
  spenderAddress!: string;

  @Column({ type: 'numeric', precision: 78, scale: 0 })
  amount!: string;

  @Column({ name: 'tx_hash', type: 'varchar', length: 66, unique: true, nullable: true })
  txHash!: string | null;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: 'pending' | 'approved' | 'failed' | 'revoked';

  @Column({ name: 'block_number', type: 'bigint', nullable: true })
  blockNumber!: number | null;

  @Column({ name: 'valid_from', type: 'timestamp with time zone' })
  validFrom!: Date;

  @Column({ name: 'expires_at', type: 'timestamp with time zone', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}