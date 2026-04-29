import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Wallet state entity
 * Step: DEX-1-0-MIGRATIONS
 * 
 * Manages wallet states for on-chain execution
 */
@Entity({ name: 'wallet_states' })
@Index('idx_wallet_states_wallet_address', ['walletAddress'])
@Index('idx_wallet_states_chain_id', ['chainId'])
@Index('idx_wallet_states_status', ['status'])
@Index('idx_wallet_states_key_id', ['keyId'])
@Index('idx_wallet_states_created_at', ['createdAt'])
export class WalletState {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ name: 'wallet_address', type: 'varchar', length: 42 })
  walletAddress!: string;

  @Column({ name: 'chain_id', type: 'integer' })
  chainId!: number;

  @Column({ name: 'wallet_type', type: 'varchar', length: 32, default: 'eoa' })
  walletType!: 'eoa' | 'multisig' | 'smart_wallet';

  @Column({ type: 'varchar', length: 32, default: 'active' })
  status!: 'active' | 'inactive' | 'rotating' | 'deprecated';

  @Column({ type: 'bigint', default: 0 })
  nonce!: number;

  @Column({ name: 'last_nonce_update', type: 'timestamp with time zone', nullable: true })
  lastNonceUpdate!: Date | null;

  @Column({ name: 'eth_balance', type: 'numeric', precision: 78, scale: 0, nullable: true })
  ethBalance!: string | null;

  @Column({ name: 'eth_balance_updated_at', type: 'timestamp with time zone', nullable: true })
  ethBalanceUpdatedAt!: Date | null;

  @Column({ name: 'key_id', type: 'varchar', length: 64 })
  keyId!: string;

  @Column({ name: 'key_version', type: 'integer', default: 1 })
  keyVersion!: number;

  @Column({ name: 'total_transactions', type: 'bigint', default: 0 })
  totalTransactions!: number;

  @Column({ name: 'total_gas_used', type: 'numeric', precision: 78, scale: 0, default: 0 })
  totalGasUsed!: string;

  @Column({ name: 'total_spent', type: 'numeric', precision: 78, scale: 0, default: 0 })
  totalSpent!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;

  @Column({ name: 'last_used_at', type: 'timestamp with time zone', nullable: true })
  lastUsedAt!: Date | null;
}