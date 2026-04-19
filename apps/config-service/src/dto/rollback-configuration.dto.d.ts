import { ConfigScopeType } from './create-configuration.dto';
export declare class RollbackConfigurationDto {
    toVersion: number;
    scopeType?: ConfigScopeType;
    scopeValue?: string;
    isSensitive?: boolean;
    approveReason?: string;
}
