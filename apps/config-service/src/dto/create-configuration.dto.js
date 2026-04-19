"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryConfigurationsDto = exports.CreateConfigurationDto = exports.ConfigScopeType = void 0;
const class_validator_1 = require("class-validator");
var ConfigScopeType;
(function (ConfigScopeType) {
    ConfigScopeType["GLOBAL"] = "global";
    ConfigScopeType["ENVIRONMENT"] = "environment";
    ConfigScopeType["TENANT"] = "tenant";
})(ConfigScopeType || (exports.ConfigScopeType = ConfigScopeType = {}));
class CreateConfigurationDto {
    configKey;
    configValue;
    isSensitive;
    scopeType;
    scopeValue;
    approveReason;
}
exports.CreateConfigurationDto = CreateConfigurationDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateConfigurationDto.prototype, "configKey", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.MaxLength)(2000),
    __metadata("design:type", String)
], CreateConfigurationDto.prototype, "configValue", void 0);
__decorate([
    (0, class_validator_1.IsBoolean)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], CreateConfigurationDto.prototype, "isSensitive", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(ConfigScopeType),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateConfigurationDto.prototype, "scopeType", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateConfigurationDto.prototype, "scopeValue", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], CreateConfigurationDto.prototype, "approveReason", void 0);
class QueryConfigurationsDto {
    scopeType;
    scopeValue;
    environment;
    tenantId;
}
exports.QueryConfigurationsDto = QueryConfigurationsDto;
__decorate([
    (0, class_validator_1.IsEnum)(ConfigScopeType),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], QueryConfigurationsDto.prototype, "scopeType", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], QueryConfigurationsDto.prototype, "scopeValue", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], QueryConfigurationsDto.prototype, "environment", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], QueryConfigurationsDto.prototype, "tenantId", void 0);
//# sourceMappingURL=create-configuration.dto.js.map