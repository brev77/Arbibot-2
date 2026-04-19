import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'watchlist_tier_snapshots' })
export class WatchlistTierSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'instrument_key', type: 'text' })
  instrumentKey!: string;

  @Column({ type: 'text' })
  tier!: string;

  @Column({ type: 'text' })
  reason!: string;

  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt!: Date;
}
