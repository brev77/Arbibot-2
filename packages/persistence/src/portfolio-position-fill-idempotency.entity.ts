import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity({ name: 'portfolio_position_fill_idempotency' })
@Unique(['legId', 'idempotencyKey'])
export class PortfolioPositionFillIdempotencyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'leg_id', type: 'uuid' })
  legId!: string;

  @Column({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
