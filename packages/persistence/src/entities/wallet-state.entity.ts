import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Address, ChainId } from '@arbibot/contracts-eth';

/**
 * Wallet State Entity
 * Tracks wallet nonce, balance, and status
 */
@Entity('wallet_states')
@Index(['walletAddress', 'chainId'])
@Index(['status'])
export class WalletState {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  keyId!: string;

  @Column({ type: 'text' })
  walletAddress!: Address;

  @Column({ type: 'integer' })
  chainId!: ChainId;

  @Column({ type: 'bigint', nullable: true })
  nonce!: number | null;

  @Column({ type: 'text', nullable: true })
  balance!: string | null;

  @Column({ type: 'enum', enum: ['active', 'inactive', 'rotating', 'frozen'], default: 'active' })
  status!: 'active' | 'inactive' | 'rotating' | 'frozen';

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}