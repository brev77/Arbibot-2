import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { PaperTradeEntity } from './paper-trade.entity';

export type PaperCapitalReservationState = 'active' | 'expired';

@Entity('paper_capital_reservations')
@Index(['instrumentKey', 'state'], { where: "state = 'active'" })
@Index(['expiresAt'], { where: "state = 'active'" })
@Index(['tradeId'], { where: 'tradeId IS NOT NULL' })
export class PaperCapitalReservationEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'instrument_key', type: 'varchar', length: 255 })
  instrumentKey!: string;

  @Column({ type: 'decimal', precision: 20, scale: 8, default: 0 })
  notional!: string;

  @Column({
    type: 'varchar',
    length: 32,
    default: 'active',
  })
  state!: PaperCapitalReservationState;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @ManyToOne(() => PaperTradeEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'trade_id' })
  trade?: PaperTradeEntity | null;

  @Column({ name: 'trade_id', type: 'uuid', nullable: true })
  tradeId?: string | null;

  @Column({ name: 'entity_version', type: 'integer', default: 1 })
  entityVersion!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
