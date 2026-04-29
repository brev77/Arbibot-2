import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * DEX pool entity
 * Step: DEX-1-0-MIGRATIONS
 * 
 * Discovered DEX pools for arbitrage opportunities
 */
@Entity({ name: 'dex_pools' })
@Index('idx_dex_pools_pool_address', ['poolAddress'])
@Index('idx_dex_pools_chain_id', ['chainId'])
@Index('idx_dex_pools_dex', ['dex'])
@Index('idx_dex_pools_token_pair', ['tokenAAddress', 'tokenBAddress'])
@Index('idx_dex_pools_is_active', ['isActive'])
@Index('idx_dex_pools_last_checked_at', ['lastCheckedAt'])
export class DexPool {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ name: 'pool_address', type: 'varchar', length: 42 })
  poolAddress!: string;

  @Column({ name: 'chain_id', type: 'integer' })
  chainId!: number;

  @Column({ type: 'varchar', length: 32 })
  dex!: 'uniswap-v2' | 'uniswap-v3' | 'sushiswap';

  @Column({ name: 'dex_version', type: 'varchar', length: 16 })
  dexVersion!: 'v2' | 'v3';

  @Column({ name: 'token_a_address', type: 'varchar', length: 42 })
  tokenAAddress!: string;

  @Column({ name: 'token_b_address', type: 'varchar', length: 42 })
  tokenBAddress!: string;

  @Column({ name: 'token_a_symbol', type: 'varchar', length: 32, nullable: true })
  tokenASymbol!: string | null;

  @Column({ name: 'token_b_symbol', type: 'varchar', length: 32, nullable: true })
  tokenBSymbol!: string | null;

  @Column({ name: 'token_a_decimals', type: 'integer', nullable: true })
  tokenADecimals!: number | null;

  @Column({ name: 'token_b_decimals', type: 'integer', nullable: true })
  tokenBDecimals!: number | null;

  @Column({ type: 'numeric', precision: 78, scale: 0, nullable: true })
  liquidity!: string | null;

  @Column({ name: 'fee_tier', type: 'integer', nullable: true })
  feeTier!: number | null;

  @Column({ name: 'tick_spacing', type: 'integer', nullable: true })
  tickSpacing!: number | null;

  @Column({ name: 'reserve_a', type: 'numeric', precision: 78, scale: 0, nullable: true })
  reserveA!: string | null;

  @Column({ name: 'reserve_b', type: 'numeric', precision: 78, scale: 0, nullable: true })
  reserveB!: string | null;

  @Column({ name: 'last_reserves_update', type: 'timestamp with time zone', nullable: true })
  lastReservesUpdate!: Date | null;

  @Column({ name: 'discovered_at', type: 'timestamp with time zone' })
  discoveredAt!: Date;

  @Column({ name: 'last_checked_at', type: 'timestamp with time zone', nullable: true })
  lastCheckedAt!: Date | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}