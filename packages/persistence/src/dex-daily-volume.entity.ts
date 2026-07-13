import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * DEX daily volume aggregate (D4-B-2-LIMITS, L2).
 *
 * Persists per-chain daily traded notional (USD) so the risk policy can enforce
 * `dex.limits.maxDailyNotionalUsd` across process restarts (replaces the
 * previous in-memory Map that reset on every restart).
 *
 * `forDate` is the UTC canonical trade date (`YYYY-MM-DD`).
 */
@Entity({ name: 'dex_daily_volume' })
@Index('idx_dex_daily_volume_chain_date', ['chainId', 'forDate'], { unique: true })
export class DexDailyVolumeEntity {
  @PrimaryGeneratedColumn('increment')
  id!: number;

  @Column({ name: 'chain_id', type: 'integer' })
  chainId!: number;

  @Column({ name: 'for_date', type: 'date' })
  forDate!: string;

  @Column({
    name: 'volume_usd',
    type: 'decimal',
    precision: 24,
    scale: 8,
    default: '0',
  })
  volumeUsd!: string;

  @Column({ name: 'trade_count', type: 'integer', default: 0 })
  tradeCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt!: Date;
}
