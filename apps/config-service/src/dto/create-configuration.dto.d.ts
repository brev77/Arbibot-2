export declare enum ConfigScopeType {
    GLOBAL = "global",
    ENVIRONMENT = "environment",
    TENANT = "tenant"
}
export declare class CreateConfigurationDto {
    configKey: string;
    configValue: string;
    isSensitive?: boolean;
    scopeType?: ConfigScopeType;
    scopeValue?: string;
    approveReason?: string;
}
export declare class QueryConfigurationsDto {
    scopeType?: ConfigScopeType;
    scopeValue?: string;
    environment?: string;
    tenantId?: string;
}
