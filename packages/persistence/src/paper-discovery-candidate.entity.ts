import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Paper Discovery Candidate entity
 * Stores paper-only arbitrage opportunities discovered by discovery worker (P3-4)
 *
 * State machine: discovered -> processed | rejected
 * - discovered: initial state after discovery
 * - processed: candidate processed (paper trade created directly in paper-trading-service)
 * - rejected: candidate failed eligibility or limits
 *
 * Note: 'enqueued' state removed to maintain paper isolation from live opportunity-service.
 * Discovery creates paper trades directly via PaperTradesService, not enqueue to opportunity-service.
 */
@Entity('paper_discovery_candidates')
@Index(['token_key', 'route_key'])
@Index('status')
@Index(['created_at'])
@Index('is_eligible', { where: 'is_eligible = true' })
export class PaperDiscoveryCandidateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100, name: 'token_key' })
  token_key!: string;

  @Column({ type: 'varchar', length: 100, name: 'route_key' })
  route_key!: string;

  /**
   * Bid price from market snapshot
   */
  @Column({ type: 'varchar', length: 100, name: 'bid_price' })
  bid_price!: string;

  /**
   * Ask price from market snapshot
   */
  @Column({ type: 'varchar', length: 100, name: 'ask_price' })
  ask_price!: string;

  /**
   * Theoretical profit in USD (after fees and slippage)
   */
  @Column({ type: 'decimal', precision: 20, scale: 6, name: 'theoretical_profit_usd' })
  theoretical_profit_usd!: string;

  /**
   * Liquidity score for this opportunity (0.0 to 1.0)
   * Higher score indicates better liquidity and lower slippage risk
   */
  @Column({ type: 'decimal', precision: 10, scale: 4, name: 'liquidity_score' })
  liquidity_score!: string;

  /**
   * Whether this candidate meets eligibility criteria for processing
   * Criteria: profit > minProfitThreshold, liquidity > minLiquidityScore
   */
  @Column({ type: 'boolean', name: 'is_eligible', default: false })
  is_eligible!: boolean;

  /**
   * State of discovery candidate
   * Values: discovered, processed, rejected
   */
  @Column({ type: 'varchar', length: 50, default: 'discovered' })
  status!: string;

  /**
   * Optimistic concurrency version
   * Used for compare-and-set pattern to prevent race conditions
   */
  @Column({ type: 'integer', name: 'entity_version', default: 1 })
  entity_version!: number;

  /**
   * When this candidate was created
   */
  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  created_at!: Date;

  /**
   * When this candidate was processed
   * Updated when status transitions to 'processed' or 'rejected'
   */
  @Column({ type: 'timestamptz', nullable: true, name: 'processed_at' })
  processed_at!: Date | null;
}

export type PaperDiscoveryCandidateStatus =
  | 'discovered'
  | 'processed'
  | 'rejected';
