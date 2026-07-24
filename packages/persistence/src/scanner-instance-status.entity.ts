import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Scanner instance runtime status (scanner-service single-writer).
 *
 * Runtime-only mirror of a scanner instance definition. The DEFINITION (network, strategy,
 * interval, filters, enabled) lives in config-service under `scanner.instances` — this table
 * does NOT duplicate configuration. It records what the running worker observed: last cycle,
 * error, counters, current status. Upserted by scanner-service after each cycle.
 *
 * See docs/adr-scanner-service.md §3 (single-writer boundaries).
 */
@Entity({ name: 'scanner_instances' })
export class ScannerInstanceStatusEntity {
  /** Matches the `id` field of the instance definition in config-service `scanner.instances`. */
  @PrimaryColumn({ type: 'varchar', length: 100, name: 'instance_id' })
  instanceId!: string;

  /** `idle | running | error` — current worker state. */
  @Column({ type: 'varchar', length: 20, name: 'status', default: 'idle' })
  status!: string;

  /** Total cycles executed since process start (resets on restart). */
  @Column({ type: 'bigint', name: 'cycles_total', default: '0' })
  cyclesTotal!: string;

  /** Total findings emitted since process start. */
  @Column({ type: 'bigint', name: 'findings_total', default: '0' })
  findingsTotal!: string;

  /** Total opportunities successfully published to opportunity-service. */
  @Column({
    type: 'bigint',
    name: 'opportunities_published_total',
    default: '0',
  })
  opportunitiesPublishedTotal!: string;

  /** Last cycle wall-clock latency in ms. */
  @Column({
    type: 'integer',
    name: 'last_cycle_latency_ms',
    nullable: true,
  })
  lastCycleLatencyMs!: number | null;

  /** When the last cycle started. */
  @Column({ type: 'timestamptz', name: 'last_run_at', nullable: true })
  lastRunAt!: Date | null;

  /** Last error message (null when status != 'error'). */
  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError!: string | null;
}

export type ScannerInstanceStatus = 'idle' | 'running' | 'error';
