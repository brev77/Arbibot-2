import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'paper_drift_samples' })
export class PaperDriftSampleEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'instrument_key', type: 'text' })
  instrumentKey!: string;

  @Column({ name: 'paper_mid', type: 'text' })
  paperMid!: string;

  @Column({ name: 'reference_mid', type: 'text' })
  referenceMid!: string;

  @Column({ name: 'drift_bps', type: 'numeric', precision: 38, scale: 18 })
  driftBps!: string;

  @CreateDateColumn({ name: 'captured_at', type: 'timestamptz' })
  capturedAt!: Date;
}
