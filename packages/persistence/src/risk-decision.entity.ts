import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'risk_decisions' })
export class RiskDecisionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'correlation_id', type: 'text' })
  correlationId!: string;

  @Column({ name: 'plan_reference', type: 'text' })
  planReference!: string;

  @Column({ type: 'text' })
  outcome!: 'approved' | 'rejected' | 'deferred';

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  reasons!: string[];

  @Column({ name: 'snapshot_version', type: 'int' })
  snapshotVersion!: number;

  @Column({ name: 'risk_mode', type: 'text', default: 'standard' })
  riskMode!: 'fast' | 'standard' | 'conservative';

  @Column({ name: 'notional_usd', type: 'decimal', precision: 24, scale: 8 })
  notionalUsd!: string;

  @Column({ name: 'idempotency_key', type: 'text', nullable: true, unique: true })
  idempotencyKey!: string | null;

  @Column({
    name: 'risk_window_reservation_id',
    type: 'uuid',
    nullable: true,
  })
  riskWindowReservationId!: string | null;

  @Column({ name: 'instrument_key', type: 'text', nullable: true })
  instrumentKey!: string | null;

  @Column({ name: 'route_key', type: 'text', nullable: true })
  routeKey!: string | null;

  @Column({ name: 'entity_version', type: 'int', default: 1 })
  entityVersion!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
