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

  /**
   * Pre-trade estimated gas cost in USD. Single-writer: execution-orchestrator.
   * NULL for legs estimated before migration 048. See migration 048.
   */
  @Column({ name: 'estimated_gas_usd', type: 'double precision', nullable: true })
  estimatedGasUsd!: number | null;

  /**
   * Pre-trade estimated slippage in basis points. DEX legs only.
   * Single-writer: execution-orchestrator.
   */
  @Column({ name: 'slippage_bps', type: 'integer', nullable: true })
  slippageBps!: number | null;

  /**
   * Pre-trade estimated pool/protocol fee in USD. DEX legs only.
   * Single-writer: execution-orchestrator.
   */
  @Column({ name: 'pool_fee_usd', type: 'double precision', nullable: true })
  poolFeeUsd!: number | null;

  /**
   * Pre-trade estimated bridge relayer+protocol fee in USD. Bridge legs only.
   * Single-writer: execution-orchestrator.
   */
  @Column({ name: 'bridge_fee_usd', type: 'double precision', nullable: true })
  bridgeFeeUsd!: number | null;

  /**
   * Sum of all cost components for this leg. Single-writer: execution-orchestrator.
   */
  @Column({ name: 'total_cost_usd', type: 'double precision', nullable: true })
  totalCostUsd!: number | null;

  /**
   * Estimate confidence: 'exact' | 'modeled' | 'unavailable'.
   * Single-writer: execution-orchestrator.
   */
  @Column({ name: 'cost_confidence', type: 'text', nullable: true })
  costConfidence!: 'exact' | 'modeled' | 'unavailable' | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
