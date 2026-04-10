import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity({ name: 'market_snapshots' })
@Unique(['venueCode', 'venueSymbol'])
export class MarketSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'venue_code', type: 'text' })
  venueCode!: string;

  @Column({ name: 'venue_symbol', type: 'text' })
  venueSymbol!: string;

  @Column({ name: 'canonical_instrument_id', type: 'uuid', nullable: true })
  canonicalInstrumentId!: string | null;

  @Column({ type: 'decimal', precision: 24, scale: 12, nullable: true })
  bid!: string | null;

  @Column({ type: 'decimal', precision: 24, scale: 12, nullable: true })
  ask!: string | null;

  @Column({ type: 'decimal', precision: 24, scale: 12, nullable: true })
  last!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload!: Record<string, unknown>;

  @Column({ name: 'observed_at', type: 'timestamptz' })
  observedAt!: Date;

  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;

  @Column({ name: 'stale_after_seconds', type: 'int', nullable: true })
  staleAfterSeconds!: number | null;

  @Column({ name: 'entity_version', type: 'int', default: 1 })
  entityVersion!: number;
}
