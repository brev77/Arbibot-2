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

  /** Entry (buy) price captured at settle. NULL until state = 'settled'. (PAD-2) */
  @Column({ name: 'entry_price', type: 'numeric', precision: 38, scale: 18, nullable: true })
  entryPrice!: string | null;

  /** Exit (sell) price captured at settle. NULL until state = 'settled'. (PAD-2) */
  @Column({ name: 'exit_price', type: 'numeric', precision: 38, scale: 18, nullable: true })
  exitPrice!: string | null;

  /** Realized paper P/L in USD at settle. NULL until state = 'settled'. (PAD-2) */
  @Column({ name: 'profit_usd', type: 'numeric', precision: 24, scale: 8, nullable: true })
  profitUsd!: string | null;

  /** Wall-clock settle timestamp. NULL until state = 'settled'. (PAD-2) */
  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt!: Date | null;

  @Column({ name: 'entity_version', type: 'int', default: 1 })
  entityVersion!: number;

  @Column({ name: 'idempotency_key', type: 'text', nullable: true, unique: true })
  idempotencyKey!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
