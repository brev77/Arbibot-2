import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'route_scoring_history' })
export class RouteScoringHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'route_key', type: 'text' })
  routeKey!: string;

  @Column({ type: 'decimal', precision: 24, scale: 8 })
  score!: string;

  @Column({ name: 'model_version', type: 'text' })
  modelVersion!: string;

  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt!: Date;
}
