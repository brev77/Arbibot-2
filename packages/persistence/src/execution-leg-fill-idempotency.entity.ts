import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { ExecutionLegEntity } from './execution-leg.entity';

@Entity({ name: 'execution_leg_fill_idempotency' })
@Unique(['legId', 'idempotencyKey'])
export class ExecutionLegFillIdempotencyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'leg_id', type: 'uuid' })
  legId!: string;

  @ManyToOne(() => ExecutionLegEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'leg_id' })
  leg!: ExecutionLegEntity;

  @Column({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string;

  @Column({ name: 'resulting_state', type: 'text' })
  resultingState!: string;

  @Column({ name: 'resulting_filled_quantity', type: 'double precision' })
  resultingFilledQuantity!: number;

  @Column({ name: 'resulting_entity_version', type: 'int' })
  resultingEntityVersion!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
