export { AuditClientModule } from './audit-client.module';
export {
  AuditClientService,
  type AuditRecordInput,
  type IAuditClient,
} from './audit-client.service';
export { HealthModule } from './health/health.module';
export {
  HealthController,
  type HealthCheckResult,
  type ReadinessReport,
} from './health/health.controller';
export {
  correlationIdPreHandler,
  getCorrelationId,
  runWithCorrelationId,
} from './correlation';
export {
  getArbibotMetricsRegistry,
  getHistogramBuckets,
  getHttpRequestHistogram,
  installMetricsOnFastify,
  type InstallMetricsOptions,
} from './metrics';
export {
  applyArbibotHttpSecurity,
  parseCorsOrigins,
  type ArbibotHttpSecurityEnv,
} from './http-security';
export { withCorrelation } from './structured-logger';
export {
  PinoLoggerService,
  type PinoLoggerServiceOptions,
} from './logging/pino-logger.service';
export { configureArbibotLogger } from './logging/configure-arbibot-logger';
export {
  ARBIBOT_LOG_REDACT_PATHS,
  ARBIBOT_REDACT_CENSOR,
} from './logging/redact.config';
export { startOpenTelemetryNodeSdkIfConfigured } from './otel';
export {
  KeyVaultModule,
  KeyVaultService,
  EncryptedKey,
  WalletKey,
  WALLET_KEY_STORE,
  type WalletKeyStore,
  type WalletKeyRecord,
} from './vault';
export * from './service-auth';
