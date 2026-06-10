import {
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';

import { PortfolioPositionEntity } from './portfolio-position.entity';

/** Idempotency for operator POST /positions/:id/close (HERMES / manual). */
@Entity({ name: 'portfolio_position_close_idempotency' })
export class PortfolioPositionCloseIdempotencyEntity {
  @PrimaryColumn({ name: 'position_id', type: 'uuid' })
  positionId!: string;

  @PrimaryColumn({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string;

  @ManyToOne(() => PortfolioPositionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'position_id' })
  position!: PortfolioPositionEntity;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
