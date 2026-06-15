import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Stores Prometheus/Alertmanager alerts forwarded via webhook receiver.
 *
 * Single-writer: `alert-receiver-service` (apps/alert-receiver-service, port 3021).
 * Drill #1 gap #1: `/incidents` previously only showed `reconciliation_mismatches`.
 */
@Entity({ name: 'alertmanager_incidents' })
@Index('idx_alertmanager_incidents_status', ['status', 'lastFiredAt'])
@Index('idx_alertmanager_incidents_severity', ['severity', 'lastFiredAt'])
@Index('idx_alertmanager_incidents_alert_name', ['alertName'])
export class AlertmanagerIncidentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'alert_name', type: 'text' })
  alertName!: string;

  @Column({ type: 'text' })
  severity!: string;

  @Column({ type: 'text', default: 'open' })
  status!: string;

  @Column({ type: 'text' })
  @Index('uq_alertmanager_incidents_fingerprint', { unique: true })
  fingerprint!: string;

  @Column({ name: 'entity_version', type: 'int', default: 1 })
  entityVersion!: number;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'jsonb', default: {} })
  payload!: Record<string, unknown>;

  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt!: Date | null;

  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt!: Date | null;

  @Column({ name: 'last_fired_at', type: 'timestamptz', default: () => 'NOW()' })
  lastFiredAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'resolved_by', type: 'text', nullable: true })
  resolvedBy!: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;
}