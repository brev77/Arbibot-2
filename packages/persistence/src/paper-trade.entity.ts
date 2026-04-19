import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const PAPER_TRADE_STATES = ['draft', 'active', 'settled', 'canceled'] as const;
export type PaperTradeState = (typeof PAPER_TRADE_STATES)[number];

@Entity({ name: 'paper_trades' })
export class PaperTradeEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'opportunity_id', type: 'uuid', nullable: true })
  opportunityId!: string | null;

  @Column({ name: 'instrument_key', type: 'text' })
  instrumentKey!: string;

  @Column({ name: 'route_key', type: 'text', nullable: true })
  routeKey!: string | null;

  @Column({ type: 'text' })
  state!: PaperTradeState;

  @Column({ type: 'numeric', precision: 38, scale: 18, default: '0' })
  notional!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  summary!: Record<string, unknown>;

  @Column({ name: 'entity_version', type: 'int', default: 1 })
  entityVersion!: number;

  @Column({ name: 'idempotency_key', type: 'text', nullable: true, unique: true })
  idempotencyKey!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
