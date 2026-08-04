import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'arbitrage_opportunities' })
export class ArbitrageOpportunityEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'correlation_id', type: 'text', nullable: true })
  correlationId!: string | null;

  @Column({ type: 'text', default: 'detected' })
  state!: string;

  @Column({ name: 'risk_decision_id', type: 'uuid', nullable: true })
  riskDecisionId!: string | null;

  /**
   * PLAN10 P10-6: dedup marker for LiveAutoDriveWorker (opp-service). Set after a
   * live execution plan is created for this opportunity. Tick filter
   * `state='risk_checked' AND live_execution_plan_id IS NULL` skips already-dispatched
   * opportunities. `null` until a live plan is created (migration 054).
   */
  @Column({ name: 'live_execution_plan_id', type: 'uuid', nullable: true })
  liveExecutionPlanId!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ name: 'entity_version', type: 'int', default: 1 })
  entityVersion!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
