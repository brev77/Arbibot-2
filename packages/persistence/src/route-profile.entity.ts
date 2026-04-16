import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'route_profiles' })
export class RouteProfileEntity {
  @PrimaryColumn({ name: 'route_key', type: 'text' })
  routeKey!: string;

  @Column({ name: 'max_notional_usd', type: 'decimal', precision: 24, scale: 8 })
  maxNotionalUsd!: string;

  @Column({ name: 'entity_version', type: 'int', default: 1 })
  entityVersion!: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
