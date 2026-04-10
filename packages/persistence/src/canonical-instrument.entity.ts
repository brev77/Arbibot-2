import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { VenueRefEntity } from './venue-ref.entity';

@Entity({ name: 'canonical_instruments' })
export class CanonicalInstrumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'venue_ref_id', type: 'uuid' })
  venueRefId!: string;

  @ManyToOne(() => VenueRefEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'venue_ref_id' })
  venueRef!: VenueRefEntity;

  @Column({ name: 'venue_symbol', type: 'text' })
  venueSymbol!: string;

  @Column({ name: 'canonical_key', type: 'text', unique: true })
  canonicalKey!: string;

  @Column({ name: 'base_asset', type: 'text' })
  baseAsset!: string;

  @Column({ name: 'quote_asset', type: 'text' })
  quoteAsset!: string;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  attributes!: Record<string, unknown>;

  @Column({ name: 'entity_version', type: 'int', default: 1 })
  entityVersion!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
