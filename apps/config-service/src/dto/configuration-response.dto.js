"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RollbackResponseDto = exports.ConfigurationHistoryItemDto = exports.ConfigurationResponseDto = void 0;
class ConfigurationResponseDto {
    id;
    configKey;
    configValue;
    isSensitive;
    entityVersion;
    createdAt;
    updatedAt;
    updatedBy;
    scopeType;
    scopeValue;
}
exports.ConfigurationResponseDto = ConfigurationResponseDto;
class ConfigurationHistoryItemDto {
    id;
    configKey;
    configValue;
    isSensitive;
    entityVersion;
    createdAt;
    updatedAt;
    updatedBy;
    isActive;
}
exports.ConfigurationHistoryItemDto = ConfigurationHistoryItemDto;
class RollbackResponseDto {
    rollbackId;
    configKey;
    toVersion;
    scopeType;
    scopeValue;
    rolledBackAt;
}
exports.RollbackResponseDto = RollbackResponseDto;
//# sourceMappingURL=configuration-response.dto.js.map