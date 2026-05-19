import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ExecutionPlanEntity } from './execution-plan.entity';

@Entity({ name: 'execution_legs' })
export class ExecutionLegEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'plan_id', type: 'uuid' })
  planId!: string;

  @ManyToOne(() => ExecutionPlanEntity, (p) => p.legs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'plan_id' })
  plan!: ExecutionPlanEntity;

  @Column({ name: 'leg_index', type: 'int' })
  legIndex!: number;

  @Column({ type: 'text', default: 'created' })
  state!: string;

  @Column({ name: 'entity_version', type: 'int', default: 1 })
  entityVersion!: number;

  /** Set when leg is submitted to a venue adapter (mock or live). */
  @Column({ name: 'venue_ref', type: 'text', nullable: true })
  venueRef!: string | null;

  /** Leg type discriminator: 'dex' for DEX swaps, 'bridge' for cross-chain bridge transfers. */
  @Column({ name: 'leg_type', type: 'text', default: 'dex' })
  legType!: 'dex' | 'bridge';

  /** Explicit chain ID for the leg (null for legacy legs). */
  @Column({ name: 'chain_id', type: 'integer', nullable: true })
  chainId!: number | null;

  @Column({ name: 'target_quantity', type: 'double precision', default: 1 })
  targetQuantity!: number;

  @Column({ name: 'filled_quantity', type: 'double precision', default: 0 })
  filledQuantity!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
