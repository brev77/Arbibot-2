"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var RedisConnection_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisConnection = void 0;
const common_1 = require("@nestjs/common");
const nest_database_1 = require("@arbibot/nest-database");
let RedisConnection = RedisConnection_1 = class RedisConnection {
    logger = new common_1.Logger(RedisConnection_1.name);
    clientInstance = null;
    get client() {
        return this.clientInstance;
    }
    async onModuleInit() {
        try {
            this.clientInstance = await (0, nest_database_1.createRedisClientFromEnv)();
            if (this.clientInstance !== null) {
                this.logger.log('Redis connected (config service cache)');
            }
        }
        catch (err) {
            this.logger.warn(`Redis unavailable; continuing without cache: ${err instanceof Error ? err.message : String(err)}`);
            this.clientInstance = null;
        }
    }
    async onModuleDestroy() {
        if (this.clientInstance === null) {
            return;
        }
        try {
            await this.clientInstance.quit();
        }
        catch (err) {
            this.logger.warn(`Redis quit failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        this.clientInstance = null;
    }
};
exports.RedisConnection = RedisConnection;
exports.RedisConnection = RedisConnection = RedisConnection_1 = __decorate([
    (0, common_1.Injectable)()
], RedisConnection);
//# sourceMappingURL=redis-connection.js.map