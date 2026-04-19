"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const platform_fastify_1 = require("@nestjs/platform-fastify");
const nest_platform_1 = require("@arbibot/nest-platform");
const app_module_1 = require("./app.module");
(0, nest_platform_1.startOpenTelemetryNodeSdkIfConfigured)({ serviceName: 'config-service' });
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, new platform_fastify_1.FastifyAdapter());
    await (0, nest_platform_1.applyArbibotHttpSecurity)(app);
    const fastify = app.getHttpAdapter().getInstance();
    fastify.addHook('preHandler', nest_platform_1.correlationIdPreHandler);
    if (process.env.METRICS_ENABLED !== 'false') {
        (0, nest_platform_1.installMetricsOnFastify)(fastify);
    }
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    }));
    const port = Number(process.env.PORT ?? 3019);
    await app.listen(port, '0.0.0.0');
}
bootstrap().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=main.js.map