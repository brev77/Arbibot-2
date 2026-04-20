import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const PAPER_PROMOTION_STATUSES = [
  'queued',
  'under_review',
  'promoted',
  'rejected',
  'expired',
] as const;
export type PaperPromotionStatus = (typeof PAPER_PROMOTION_STATUSES)[number];

@Entity({ name: 'paper_promotion_candidates' })
export class PaperPromotionCandidateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'instrument_key', type: 'text' })
  instrumentKey!: string;

  @Column({ name: 'opportunity_id', type: 'uuid', nullable: true })
  opportunityId!: string | null;

  @Column({ type: 'text', default: 'paper_discovery' })
  source!: string;

  @Column({ type: 'text' })
  status!: PaperPromotionStatus;

  @Column({ type: 'numeric', precision: 38, scale: 18, nullable: true })
  score!: string | null;

  @Column({ name: 'drift_bps', type: 'numeric', precision: 38, scale: 18, nullable: true })
  driftBps!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  evidence!: Record<string, unknown>;

  @Column({ name: 'entity_version', type: 'int', default: 1 })
  entityVersion!: number;

  /** Persisted quality score (worker); optional — API may derive live from score/drift. */
  @Column({ name: 'quality_score', type: 'numeric', precision: 38, scale: 18, nullable: true })
  qualityScore!: string | null;

  /** Persisted tier: high | medium | low (worker). */
  @Column({ name: 'quality_tier', type: 'text', nullable: true })
  qualityTier!: string | null;

  /** Stable key for idempotent create (e.g. opportunityId + instrumentKey). */
  @Column({ name: 'enqueue_idempotency_key', type: 'text', nullable: true })
  enqueueIdempotencyKey!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
