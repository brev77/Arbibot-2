import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'risk_window_reservations' })
export class RiskWindowReservationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'window_key', type: 'text' })
  windowKey!: string;

  @Column({ name: 'correlation_id', type: 'text' })
  correlationId!: string;

  @Column({ name: 'plan_reference', type: 'text' })
  planReference!: string;

  @Column({ name: 'notional_usd', type: 'decimal', precision: 24, scale: 8 })
  notionalUsd!: string;

  @Column({
    type: 'text',
    default: 'reserved',
  })
  state!: 'reserved' | 'consumed' | 'expired' | 'released';

  @Column({ name: 'entity_version', type: 'int', default: 1 })
  entityVersion!: number;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
