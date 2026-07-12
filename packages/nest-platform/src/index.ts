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
export { startOpenTelemetryNodeSdkIfConfigured } from './otel';
export {
  KeyVaultModule,
  KeyVaultService,
  EncryptedKey,
  WalletKey,
} from './vault';
export * from './service-auth';
