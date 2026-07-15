import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'portfolio_positions' })
export class PortfolioPositionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'plan_id', type: 'uuid', nullable: true })
  planId!: string | null;

  @Column({ name: 'instrument_key', type: 'text' })
  instrumentKey!: string;

  @Column({ type: 'numeric', precision: 38, scale: 18, default: 0 })
  quantity!: string;

  /**
   * Cumulative USD notional of fills for this position (D4-B-3-CEILING).
   * Single-writer: portfolio-service (`PositionsService.confirmFill`). Counted
   * into the aggregate capital ceiling in capital-service when `quantity <> 0`
   * (open). Defaults to '0'; existing rows backfilled by migration 040.
   */
  @Column({ name: 'notional_usd', type: 'numeric', precision: 24, scale: 8, default: '0' })
  notionalUsd!: string;

  @Column({ name: 'entity_version', type: 'int', default: 1 })
  entityVersion!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
