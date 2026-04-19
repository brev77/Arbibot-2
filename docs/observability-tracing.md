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
| `PaperDriftSamplingStalled` (v0) | `increase(arb_paper_drift_samples_recorded_total[30m]) == 0` on **`paper-trading-service`** while paper drift ingestion is expected (tune `for`/`unless` with deploy labels). | ticket | **v0 doc target only:** counter proves samples were recorded, not bps magnitude. **Future:** expose last / max **drift bps** (gauge or aggregated series) and alert `PaperDriftBpsHigh` above a route/instrument threshold; wire in `PRIO-P1-ALERT` / `P2-2.3-GRAF`. |
| `PaperDriftBpsHigh` (v1) | `max(arb_paper_drift_bps{route_key=~".+"}) > 50` over 5m window on **`paper-trading-service`** when drift samples are being recorded. | ticket | **v1:** alert when drift exceeds 50 bps on any route; indicates paper vs live price divergence requiring investigation before promotion. Target for `PRIO-P2-PAPERDISC` quality gates. |

## SLO and on-call (v0, `PRIO-P1-ALERT`)

**Status:** engineering v0 — targets below are **defaults for local/staging** until product owners replace owners and wire paging.

| Tier | Latency (sync API p99) | Availability | Owner |
|------|------------------------|--------------|-------|
| Tier1 | 500 ms (evaluate / reserve / arm path) | 99.5% monthly | Platform on-call (see team roster) |
| Tier2 | 2 s (read dashboards) | 99% monthly | Business hours coverage |

**On-call v0:** route `ArbibotHttp5xxRate`, `ReconciliationOpenMismatches`, and `KafkaPublishFailures` (when exporters exist) to the team’s primary incident channel; document escalation paths in the operator handbook when published.

**Histogram note:** `http_request_duration_seconds` in alert rows remains a **target** until histogram instrumentation lands in `@arbibot/nest-platform`; use `arb_http_requests_total` and logs with `x-correlation-id` for regressions meanwhile.

## Grafana (P2-2.3-GRAF)

Starter dashboard JSON: [`infra/grafana/dashboards/arbibot-http-overview.json`](../infra/grafana/dashboards/arbibot-http-overview.json) (import into Grafana with a Prometheus datasource; if UID differs from `prometheus`, re-bind panels in the UI). Instructions: [`infra/grafana/README.md`](../infra/grafana/README.md).

## SLO and on-call (v1)

**Status:** production-ready baseline — targets below are **agreed by owner** and ready for paging integration.

|| Tier | Latency (sync API p99) | Availability | Owner | PagerDuty Integration |
||------|------------------------|--------------|-------|------------------------|
|| Critical (opportunity, risk, orchestrator) | 300 ms | 99.9% monthly | Platform Lead | `arbibot-critical` schedule |
|| Standard (canonical, intake, audit, portfolio, reconciliation) | 2 s | 99.5% monthly | Platform on-call | `arbibot-standard` schedule |
|| Read-only (dashboard, config, paper) | 5 s | 99% monthly | Business hours | `arbibot-read-only` schedule |

**Uptime baseline alert:**
```yaml
# Prometheus alert rule (example)
- alert: ArbibotServiceUptime
  expr: up{job=~"opportunity-service|risk-service|execution-orchestrator"} == 0
  for: 1m
  labels:
    severity: page
    team: platform
  annotations:
    summary: "Service {{ $labels.job }} is down"
    description: "{{ $labels.job }} has been down for more than 1 minute"
```

### On-call rotation template

**Slack channel:** `#arbibot-on-call` (primary incident channel)

**Escalation policy:**
1. **Tier 1:** On-call engineer (first 15 min)
2. **Tier 2:** Platform Lead (15-30 min)
3. **Tier 3:** Engineering Manager (30+ min)

**Runbook per incident type:**
- **Execution gap:** Check venue status, reconciliation mismatches, `docs/reconciliation-p0-procedures.md`
- **Risk timeout:** Review risk-service logs, risk window reservations, manual approval queue
- **Paper drift high:** Compare paper vs live prices, disable paper promotion if > 100 bps

**PagerDuty integration:**
- Service: `Arbibot Critical`
- Escalation policy: `Arbibot Escalation` (1m → 15m → 30m)
- Notification channels: Slack, SMS, email
- On-call schedule: `arbibot-critical` (weekly rotation, handoff Monday 9:00 UTC)

**Incident lifecycle:**
1. **Detection:** Alert fires → PagerDuty page → Slack notification
2. **Acknowledgement:** On-call engineer acknowledges in PagerDuty (5 min SLA)
3. **Investigation:** Check Grafana dashboards, logs, reconciliation mismatches
4. **Mitigation:** Execute runbook steps (manual approval, disable feature, rollback)
5. **Resolution:** Fix deployed, monitoring returns to normal
6. **Post-mortem:** Document in `/runbooks` within 24h (Section: What happened, Impact, Root cause, Timeline, Prevention)

**Note on `http_request_duration_seconds` histogram:** Still a **target** until histogram instrumentation lands in `@arbibot/nest-platform`; use `arb_http_requests_total` and logs with `x-correlation-id` for latency regressions meanwhile.

**Histogram instrumentation (implemented 2026-04-18):**
- **Metric:** `http_request_duration_seconds` (histogram) registered per service via `@arbibot/nest-platform`
- **Buckets:** `[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5]` (1ms, 5ms, 10ms, 50ms, 100ms, 500ms, 1s, 2s, 5s)
- **Critical path override:** tighter buckets `[0.001, 0.005, 0.01, 0.05, 0.1, 0.3]` for opportunity/risk/orchestrator (max 300ms Tier 1 SLO)
- **Alert calculation:**
  - p99: `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))`
  - p95: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))`
  - p50: `histogram_quantile(0.5, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))`
- **Migration status:** Phase 2 — histogram collection active; alerts migrated to quantiles; `arb_http_requests_total` deprecated for latency monitoring
