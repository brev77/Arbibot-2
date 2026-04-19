import { ConfigScopeType } from './create-configuration.dto';

export class ConfigurationResponseDto {
  id!: string;

  configKey!: string;

  configValue!: string;

  isSensitive!: boolean;

  entityVersion!: number;

  createdAt!: Date;

  updatedAt!: Date;

  updatedBy!: string | null;

  scopeType!: ConfigScopeType;

  scopeValue!: string | null;
}

export class ConfigurationHistoryItemDto {
  id!: string;

  configKey!: string;

  configValue!: string;

  isSensitive!: boolean;

  entityVersion!: number;

  createdAt!: Date;

  updatedAt!: Date;

  updatedBy!: string | null;

  isActive!: boolean;
}

// Response for rollback operation
export class RollbackResponseDto {
  rollbackId!: string;

  configKey!: string;

  toVersion!: number;

  scopeType!: ConfigScopeType;

  scopeValue!: string | null;

  rolledBackAt!: Date;
}
