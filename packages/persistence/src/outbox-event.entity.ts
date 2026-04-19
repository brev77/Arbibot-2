import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'outbox_events' })
export class OutboxEventEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ name: 'message_id', type: 'uuid', unique: true })
  messageId!: string;

  @Column({ name: 'event_type', type: 'text' })
  eventType!: string;

  @Column({ name: 'entity_type', type: 'text' })
  entityType!: string;

  @Column({ name: 'entity_id', type: 'text' })
  entityId!: string;

  @Column({ name: 'schema_version', type: 'int' })
  schemaVersion!: number;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  envelope!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt!: Date | null;

  @Column({ name: 'relay_dead_letter_at', type: 'timestamptz', nullable: true })
  relayDeadLetterAt!: Date | null;

  @Column({ name: 'relay_dead_letter_reason', type: 'text', nullable: true })
  relayDeadLetterReason!: string | null;

  @Column({ name: 'relay_delivery_attempts', type: 'int', default: 0 })
  relayDeliveryAttempts!: number;

  /** Pending paper promotion rows: at most one per key (partial unique index, migration 018). */
  @Column({
    name: 'paper_enqueue_idempotency_key',
    type: 'text',
    nullable: true,
  })
  paperEnqueueIdempotencyKey!: string | null;
}
