import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

/**
 * Scanner finding — a raw cross-venue spread detected by scanner-service.
 *
 * A finding is NOT an opportunity. It is a market observation: "token X is priced Y bps
 * cheaper on venue A than venue B on chain C". When the finding passes filters, scanner-service
 * publishes it to opportunity-service (`POST /opportunities`) and records the resulting
 * `opportunityId` here. If publication fails (opportunity-service down), the finding is retained
 * with `publishStatus='failed'` and retried by the orphan worker.
 *
 * Single-writer: scanner-service. See docs/adr-scanner-service.md §3.
 *
 * Retention: rows older than `scanner.defaults.findingsRetentionDays` (default 7) are deleted
 * by the cleanup worker (Phase 5). See review-gate-scanner.md Phase 5.
 */
@Entity({ name: 'scanner_findings' })
@Index('idx_scanner_findings_observed_at', ['observedAt'])
@Index('idx_scanner_findings_instance_observed', ['instanceId', 'observedAt'])
@Index('idx_scanner_findings_opportunity', ['opportunityId'])
// Partial index for the orphan retry worker — only pending rows need scanning.
@Index('idx_scanner_findings_pending', ['publishStatus'], {
  where: "publish_status = 'pending'",
})
export class ScannerFindingEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** FK to the instance definition id in config-service `scanner.instances`. */
  @Column({ type: 'varchar', length: 100, name: 'instance_id' })
  instanceId!: string;

  /** Opportunity id once published to opportunity-service; null until `publishStatus='published'`. */
  @Column({ type: 'uuid', name: 'opportunity_id', nullable: true })
  opportunityId!: string | null;

  /** `pending | published | failed` — publication state to opportunity-service. */
  @Column({
    type: 'varchar',
    length: 20,
    name: 'publish_status',
    default: 'pending',
  })
  publishStatus!: string;

  /** Cumulative publish attempts (incremented on each retry). */
  @Column({
    type: 'integer',
    name: 'publish_attempts',
    default: 0,
  })
  publishAttempts!: number;

  @Column({ type: 'varchar', length: 100, name: 'canonical_token' })
  canonicalToken!: string;

  @Column({ type: 'integer', name: 'chain_id' })
  chainId!: number;

  @Column({ type: 'varchar', length: 50, name: 'buy_venue' })
  buyVenue!: string;

  @Column({ type: 'varchar', length: 50, name: 'sell_venue' })
  sellVenue!: string;

  @Column({ type: 'varchar', length: 66, name: 'buy_pool_addr' })
  buyPoolAddr!: string;

  @Column({ type: 'varchar', length: 66, name: 'sell_pool_addr' })
  sellPoolAddr!: string;

  /** Cross-venue spread in basis points (buy price − sell price, positive when arb exists). */
  @Column({ type: 'integer', name: 'spread_bps' })
  spreadBps!: number;

  @Column({ type: 'decimal', precision: 20, scale: 6, name: 'gross_profit_usd' })
  grossProfitUsd!: string;

  /** Net of pool fees + gas estimate (no slippage — that lives in execution). */
  @Column({
    type: 'decimal',
    precision: 20,
    scale: 6,
    name: 'net_profit_usd',
  })
  netProfitUsd!: string;

  @Column({ type: 'decimal', precision: 20, scale: 6, name: 'fees_usd' })
  feesUsd!: string;

  /** Observed 1h volume in USD (null when volume filter disabled / unavailable). */
  @Column({
    type: 'decimal',
    precision: 24,
    scale: 8,
    name: 'volume_1h_usd',
    nullable: true,
  })
  volume1hUsd!: string | null;

  /** Observed 24h volume in USD (null when volume filter disabled / unavailable). */
  @Column({
    type: 'decimal',
    precision: 24,
    scale: 8,
    name: 'volume_24h_usd',
    nullable: true,
  })
  volume24hUsd!: string | null;

  /** When the spread was observed on-chain. */
  @CreateDateColumn({ type: 'timestamptz', name: 'observed_at' })
  observedAt!: Date;
}

export type ScannerFindingPublishStatus = 'pending' | 'published' | 'failed';
