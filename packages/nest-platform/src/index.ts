export { AuditClientModule } from './audit-client.module';
export {
  AuditClientService,
  type AuditRecordInput,
} from './audit-client.service';
export {
  correlationIdPreHandler,
  getCorrelationId,
  runWithCorrelationId,
} from './correlation';
export { installMetricsOnFastify } from './metrics';
export { withCorrelation } from './structured-logger';
