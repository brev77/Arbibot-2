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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigController = void 0;
const common_1 = require("@nestjs/common");
const configurations_service_1 = require("./configurations.service");
const create_configuration_dto_1 = require("../dto/create-configuration.dto");
const rollback_configuration_dto_1 = require("../dto/rollback-configuration.dto");
let ConfigController = class ConfigController {
    configurationsService;
    constructor(configurationsService) {
        this.configurationsService = configurationsService;
    }
    async getAll(query) {
        return this.configurationsService.getAll(query);
    }
    async getEffective(configKey, environment, tenantId) {
        const config = await this.configurationsService.getEffective(configKey, environment, tenantId);
        if (!config) {
            throw new Error(`Configuration not found: ${configKey}`);
        }
        return config;
    }
    async getByKey(configKey, scopeType, scopeValue) {
        const config = await this.configurationsService.getByKey(configKey, scopeType, scopeValue || null);
        if (!config) {
            throw new Error(`Configuration not found: ${configKey}`);
        }
        return config;
    }
    async getHistory(configKey, scopeType, scopeValue) {
        return this.configurationsService.getHistory(configKey, scopeType || create_configuration_dto_1.ConfigScopeType.GLOBAL, scopeValue || null);
    }
    async create(dto, operatorId, reply) {
        if (!operatorId) {
            reply.status(common_1.HttpStatus.BAD_REQUEST).send({ error: 'operatorId is required' });
            return;
        }
        return this.configurationsService.create(dto, operatorId);
    }
    async update(configKey, dto, operatorId, reply) {
        if (!operatorId) {
            reply.status(common_1.HttpStatus.BAD_REQUEST).send({ error: 'operatorId is required' });
            return;
        }
        return this.configurationsService.update(configKey, dto, operatorId);
    }
    async rollback(configKey, dto, operatorId, reply) {
        if (!operatorId) {
            reply.status(common_1.HttpStatus.BAD_REQUEST).send({ error: 'operatorId is required' });
            return;
        }
        return this.configurationsService.rollback(configKey, dto, operatorId);
    }
};
exports.ConfigController = ConfigController;
__decorate([
    (0, common_1.Get)('configurations'),
    __param(0, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_configuration_dto_1.QueryConfigurationsDto]),
    __metadata("design:returntype", Promise)
], ConfigController.prototype, "getAll", null);
__decorate([
    (0, common_1.Get)('configurations/:configKey/effective'),
    __param(0, (0, common_1.Param)('configKey')),
    __param(1, (0, common_1.Query)('environment')),
    __param(2, (0, common_1.Query)('tenantId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], ConfigController.prototype, "getEffective", null);
__decorate([
    (0, common_1.Get)('configurations/:configKey'),
    __param(0, (0, common_1.Param)('configKey')),
    __param(1, (0, common_1.Query)('scopeType')),
    __param(2, (0, common_1.Query)('scopeValue')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], ConfigController.prototype, "getByKey", null);
__decorate([
    (0, common_1.Get)('configurations/:configKey/history'),
    __param(0, (0, common_1.Param)('configKey')),
    __param(1, (0, common_1.Query)('scopeType')),
    __param(2, (0, common_1.Query)('scopeValue')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], ConfigController.prototype, "getHistory", null);
__decorate([
    (0, common_1.Post)('configurations'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Body)('operatorId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_configuration_dto_1.CreateConfigurationDto, String, Object]),
    __metadata("design:returntype", Promise)
], ConfigController.prototype, "create", null);
__decorate([
    (0, common_1.Put)('configurations/:configKey'),
    __param(0, (0, common_1.Param)('configKey')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Body)('operatorId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String, Object]),
    __metadata("design:returntype", Promise)
], ConfigController.prototype, "update", null);
__decorate([
    (0, common_1.Post)('configurations/:configKey/rollback'),
    __param(0, (0, common_1.Param)('configKey')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Body)('operatorId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, rollback_configuration_dto_1.RollbackConfigurationDto, String, Object]),
    __metadata("design:returntype", Promise)
], ConfigController.prototype, "rollback", null);
exports.ConfigController = ConfigController = __decorate([
    (0, common_1.Controller)('policy'),
    __metadata("design:paramtypes", [configurations_service_1.ConfigurationsService])
], ConfigController);
//# sourceMappingURL=config.controller.js.map