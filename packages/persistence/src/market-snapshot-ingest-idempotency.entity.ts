import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import { MarketSnapshotEntity } from './market-snapshot.entity';

@Entity({ name: 'market_snapshot_ingest_idempotency' })
export class MarketSnapshotIngestIdempotencyEntity {
  @PrimaryColumn({ name: 'idempotency_key', type: 'uuid' })
  idempotencyKey!: string;

  @Column({ name: 'request_hash', type: 'text' })
  requestHash!: string;

  @Column({ name: 'snapshot_id', type: 'uuid' })
  snapshotId!: string;

  @ManyToOne(() => MarketSnapshotEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'snapshot_id' })
  snapshot!: MarketSnapshotEntity;

  @Column({ name: 'outbox_message_id', type: 'uuid', nullable: true })
  outboxMessageId!: string | null;

  @Column({ name: 'entity_version', type: 'int' })
  entityVersion!: number;

  @Column({ name: 'unchanged', type: 'boolean', default: false })
  unchanged!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
