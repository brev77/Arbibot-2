import { ConfigScopeType } from './create-configuration.dto';
export declare class ConfigurationResponseDto {
    id: string;
    configKey: string;
    configValue: string;
    isSensitive: boolean;
    entityVersion: number;
    createdAt: Date;
    updatedAt: Date;
    updatedBy: string | null;
    scopeType: ConfigScopeType;
    scopeValue: string | null;
}
export declare class ConfigurationHistoryItemDto {
    id: string;
    configKey: string;
    configValue: string;
    isSensitive: boolean;
    entityVersion: number;
    createdAt: Date;
    updatedAt: Date;
    updatedBy: string | null;
    isActive: boolean;
}
export declare class RollbackResponseDto {
    rollbackId: string;
    configKey: string;
    toVersion: number;
    scopeType: ConfigScopeType;
    scopeValue: string | null;
    rolledBackAt: Date;
}
