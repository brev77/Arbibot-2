export { AuditClientModule } from './audit-client.module';
export {
  AuditClientService,
  type AuditRecordInput,
  type IAuditClient,
} from './audit-client.service';
export {
  correlationIdPreHandler,
  getCorrelationId,
  runWithCorrelationId,
} from './correlation';
export { installMetricsOnFastify } from './metrics';
export {
  applyArbibotHttpSecurity,
  parseCorsOrigins,
  type ArbibotHttpSecurityEnv,
} from './http-security';
export { withCorrelation } from './structured-logger';
export { startOpenTelemetryNodeSdkIfConfigured } from './otel';
