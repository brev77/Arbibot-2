import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';

const SERVICE_NAME_ATTR = 'service.name';

let started = false;

/**
 * Starts Node SDK + auto-instrumentations when OTLP is configured (Phase 2 / P2-2.3-TRACE).
 * Call once at process entry, before creating the HTTP server, when `reflect-metadata` is loaded.
 *
 * Enabled when `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is set
 * and `OTEL_SDK_DISABLED` is not `true` and `OTEL_TRACES_EXPORTER` is not `none`.
 */
export function startOpenTelemetryNodeSdkIfConfigured(options: {
  readonly serviceName: string;
}): void {
  if (started) {
    return;
  }
  if (process.env.OTEL_SDK_DISABLED === 'true') {
    return;
  }
  if (process.env.OTEL_TRACES_EXPORTER === 'none') {
    return;
  }
  const endpointConfigured =
    (process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? '').length > 0 ||
    (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? '').length > 0;
  if (!endpointConfigured) {
    return;
  }

  const resource = resourceFromAttributes({
    [SERVICE_NAME_ATTR]: options.serviceName,
  });

  const traceExporter = new OTLPTraceExporter();

  const sdk = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
  started = true;

  const flush = (): void => {
    void sdk.shutdown().catch(() => undefined);
  };
  process.once('SIGTERM', flush);
  process.once('SIGINT', flush);
}
