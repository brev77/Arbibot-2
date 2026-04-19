export enum ConfigScopeType {
  GLOBAL = 'global',
  ENVIRONMENT = 'environment',
  TENANT = 'tenant',
}

export interface ConfigurationDto {
  id: string;
  configKey: string;
  configValue: string;
  isSensitive: boolean;
  entityVersion: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  scopeType: ConfigScopeType;
  scopeValue: string | null;
}

export interface ConfigurationHistoryItemDto {
  id: string;
  configKey: string;
  configValue: string;
  isSensitive: boolean;
  entityVersion: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  isActive: boolean;
}

export interface RollbackResponseDto {
  rollbackId: string;
  configKey: string;
  toVersion: number;
  scopeType: ConfigScopeType;
  scopeValue: string | null;
  rolledBackAt: string;
}

export interface CreateConfigurationDto {
  configKey: string;
  configValue: string;
  isSensitive?: boolean;
  scopeType?: ConfigScopeType;
  scopeValue?: string;
  approveReason?: string;
}

export interface RollbackConfigurationDto {
  toVersion: number;
  scopeType?: ConfigScopeType;
  scopeValue?: string;
  isSensitive?: boolean;
  approveReason?: string;
}

export interface QueryConfigurationsDto {
  scopeType?: ConfigScopeType;
  scopeValue?: string;
  environment?: string;
  tenantId?: string;
}
