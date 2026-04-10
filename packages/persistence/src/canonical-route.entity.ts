import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { CanonicalInstrumentEntity } from './canonical-instrument.entity';

@Entity({ name: 'canonical_routes' })
@Unique('uq_canonical_routes_source_target', [
  'sourceInstrumentId',
  'targetInstrumentId',
])
export class CanonicalRouteEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'route_key', type: 'text', unique: true })
  routeKey!: string;

  @Column({ name: 'source_instrument_id', type: 'uuid' })
  sourceInstrumentId!: string;

  @ManyToOne(() => CanonicalInstrumentEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'source_instrument_id' })
  sourceInstrument!: CanonicalInstrumentEntity;

  @Column({ name: 'target_instrument_id', type: 'uuid' })
  targetInstrumentId!: string;

  @ManyToOne(() => CanonicalInstrumentEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'target_instrument_id' })
  targetInstrument!: CanonicalInstrumentEntity;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  hops!: unknown[];

  @Column({ name: 'entity_version', type: 'int', default: 1 })
  entityVersion!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
