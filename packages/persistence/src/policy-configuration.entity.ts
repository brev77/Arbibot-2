import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ConfigScopeType {
  GLOBAL = 'global',
  ENVIRONMENT = 'environment',
  TENANT = 'tenant',
}

@Entity('policy_configurations')
@Index('idx_policy_configurations_config_key', ['configKey'])
@Index('idx_policy_configurations_updated_at', ['updatedAt'])
export class PolicyConfigurationEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'text' })
  configKey!: string;

  @Column({ type: 'text' })
  configValue!: string;

  @Column({ type: 'boolean', default: false })
  isSensitive!: boolean;

  @Column({ type: 'int', default: 1 })
  entityVersion!: number;

  @CreateDateColumn({ type: 'timestamp with time zone' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamp with time zone' })
  updatedAt!: Date;

  @Column({ type: 'text', nullable: true })
  updatedBy!: string | null;

  // CFG-3: Scoped configuration fields (added in migration 020)
  @Column({
    type: 'enum',
    enum: ConfigScopeType,
    default: ConfigScopeType.GLOBAL,
    nullable: true,
  })
  scopeType!: ConfigScopeType | null;

  @Column({ type: 'text', nullable: true })
  scopeValue!: string | null;

  @Column({ type: 'boolean', default: true, nullable: true })
  isActive!: boolean | null;
}
