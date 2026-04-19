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
exports.RollbackConfigurationDto = void 0;
const class_validator_1 = require("class-validator");
const create_configuration_dto_1 = require("./create-configuration.dto");
class RollbackConfigurationDto {
    toVersion;
    scopeType;
    scopeValue;
    isSensitive;
    approveReason;
}
exports.RollbackConfigurationDto = RollbackConfigurationDto;
__decorate([
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", Number)
], RollbackConfigurationDto.prototype, "toVersion", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(create_configuration_dto_1.ConfigScopeType),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], RollbackConfigurationDto.prototype, "scopeType", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], RollbackConfigurationDto.prototype, "scopeValue", void 0);
__decorate([
    (0, class_validator_1.IsBoolean)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Boolean)
], RollbackConfigurationDto.prototype, "isSensitive", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.MaxLength)(255),
    __metadata("design:type", String)
], RollbackConfigurationDto.prototype, "approveReason", void 0);
//# sourceMappingURL=rollback-configuration.dto.js.map