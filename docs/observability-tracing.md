# Observability: tracing (P2-2.3-TRACE)

## OpenTelemetry (Nest services)

All first-wave HTTP services call `startOpenTelemetryNodeSdkIfConfigured` from `@arbibot/nest-platform` at process entry. Tracing is **off by default** until OTLP env vars are set (no overhead in local dev unless you opt in).

### Enable locally

1. Run a collector that accepts OTLP/HTTP (for example Grafana Alloy, OpenTelemetry Collector, or Tempo with OTLP enabled).
2. In `.env` (or per-process env):

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
# Optional override; otherwise the HTTP exporter uses the standard traces path under the endpoint above.
# OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4318/v1/traces

# Disable without unsetting other vars:
# OTEL_SDK_DISABLED=true
# OTEL_TRACES_EXPORTER=none
```

3. Restart the service. Auto-instrumentation covers Node `http`/`https` (incoming Fastify and outbound `fetch` where supported). `service.name` is fixed per binary (see each app `main.ts`).

`x-correlation-id` continues to be the primary cross-service log/metrics key; traces add span hierarchy and latency breakdown for execution and reconciliation reviews.

## Alert catalog (baseline, §26.2)

These are **documentation targets** for Prometheus/Grafana (metrics already on `GET /metrics` per `P1-1.1-OBS`). Wire recording rules and notification policies in `P2-2.3-GRAF` / infra IaC.

| Alert | Signal | Severity | Rationale |
|-------|--------|----------|-----------|
| `ArbibotHttp5xxRate` | `rate(http_requests_total{status=~"5.."}[5m])` by service | page | User-facing or chain-breaking failures. |
| `ArbibotHttpLatencyP99` | histogram `http_request_duration_seconds` p99 | ticket | Regressions before SLO breach. |
| `OutboxRelayLag` | custom gauge / age of oldest unprocessed outbox row | page | Risk to async domain convergence (when exporter exists). |
| `KafkaPublishFailures` | bridge error counter (if exposed) | page | Bus path for `SnapshotUpdated` / `CapitalReserved` / `PlanArmed`. |
| `PostgresConnectionsHigh` | pool / `pg_stat_activity` derivative | ticket | Capacity headroom. |
| `ReconciliationOpenMismatches` | `count(reconciliation_mismatch_open)` or periodic `GET /mismatches?status=open` exporter | ticket | Settlement / execution gaps (`P2-2.1-RECON`); pair with `/mismatches/run-detectors` schedule. |

## SLO and on-call (draft, `PRIO-P1-ALERT`)

This section is a **placeholder** until product owners sign SLOs and paging routes.

| Tier | Latency (sync API p99) | Availability | Owner |
|------|------------------------|--------------|-------|
| Tier1 | 500 ms (evaluate / reserve / arm path) | 99.5% monthly | TBD on-call rotation |
| Tier2 | 2 s (read dashboards) | 99% monthly | Best-effort business hours |

**On-call:** wire Prometheus/Grafana alerts from the table above to your incident tool (PagerDuty, Opsgenie, etc.); document escalation in the operator handbook when it exists.

## Grafana (P2-2.3-GRAF)

Starter dashboard JSON: [`infra/grafana/dashboards/arbibot-http-overview.json`](../infra/grafana/dashboards/arbibot-http-overview.json) (import into Grafana with a Prometheus datasource; if UID differs from `prometheus`, re-bind panels in the UI). Instructions: [`infra/grafana/README.md`](../infra/grafana/README.md).
