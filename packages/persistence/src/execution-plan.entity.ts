import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ExecutionLegEntity } from './execution-leg.entity';

@Entity({ name: 'execution_plans' })
export class ExecutionPlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'correlation_id', type: 'text', nullable: true })
  correlationId!: string | null;

  @Column({ type: 'text', default: 'planned' })
  state!: string;

  @Column({ name: 'capital_reservation_id', type: 'uuid', nullable: true })
  capitalReservationId!: string | null;

  @Column({ name: 'risk_decision_id', type: 'uuid', nullable: true })
  riskDecisionId!: string | null;

  @Column({ name: 'entity_version', type: 'int', default: 1 })
  entityVersion!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => ExecutionLegEntity, (leg) => leg.plan)
  legs!: ExecutionLegEntity[];
}
