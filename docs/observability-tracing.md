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
| `IntakeDegradationStale` | `arb_intake_degradation_active == 1` (or equivalent) on **market-intake-service** for extended window | page/ticket | Policy cache / throttling stuck in degraded mode — see [`docs/intake-degradation-runbook.md`](intake-degradation-runbook.md). |
| `PaperDriftSamplingStalled` (v0) | `increase(arb_paper_drift_samples_recorded_total[30m]) == 0` on **`paper-trading-service`** while paper drift ingestion is expected (tune `for`/`unless` with deploy labels). | ticket | **v0 doc target only:** counter proves samples were recorded, not bps magnitude. **Future:** expose last / max **drift bps** (gauge or aggregated series) and alert `PaperDriftBpsHigh` above a route/instrument threshold; wire in `PRIO-P1-ALERT` / `P2-2.3-GRAF`. |
| `PaperDriftBpsHigh` (v1) | `max(arb_paper_drift_bps_current{route_key=~".+"}) > 50` over 5m window on **`paper-trading-service`** when drift samples are being recorded. | ticket | **v1:** alert when drift exceeds 50 bps on any route; indicates paper vs live price divergence requiring investigation before promotion. Uses recording rule `arb_paper_drift_bps_max_15m` for accuracy. Target for `PRIO-P2-PAPERDISC` quality gates. |
| `PaperDriftBpsSustainedHigh` (v2) | `arb_paper_drift_bps_avg_5m > 30` for 15m consecutive windows on **`paper-trading-service`**. | warning | **v2:** alert when average drift exceeds 30 bps for sustained period (15m); indicates persistent paper vs live divergence that may affect promotion decisions. Uses recording rule `arb_paper_drift_bps_avg_5m`. |

## SLO and on-call (v0, `PRIO-P1-ALERT`)

**Status:** engineering v0 — targets below are **defaults for local/staging** until product owners replace owners and wire paging.

| Tier | Latency (sync API p99) | Availability | Owner |
|------|------------------------|--------------|-------|
| Tier1 | 500 ms (evaluate / reserve / arm path) | 99.5% monthly | Platform on-call (see team roster) |
| Tier2 | 2 s (read dashboards) | 99% monthly | Business hours coverage |

**On-call v0:** route `ArbibotHttp5xxRate`, `ReconciliationOpenMismatches`, and `KafkaPublishFailures` (when exporters exist) to the team’s primary incident channel; document escalation paths in the operator handbook when published.

**Histogram note:** `http_request_duration_seconds` is emitted from `@arbibot/nest-platform` (`installMetricsOnFastify` with a `service` label). Use Grafana panels that group by `service`; keep `arb_http_requests_total` for rate/error ratios alongside quantiles.

**Bucket reference (PRIO-P1-ALERT):** default latency buckets are `[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5]` seconds — exposed from code via `getHistogramBuckets()` and `getHttpRequestHistogram()` in `@arbibot/nest-platform` (`packages/nest-platform/src/metrics.ts`) for dashboards and custom SLO queries.

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

**Wiring (D4-A-2-PAGING, 2026-07):** Paging is wired in code, not just docs.
- Config: `infra/alertmanager/alertmanager.yml.tpl` — rendered at container start by `infra/docker/entrypoint.alertmanager.sh` (envsubst).
- Secrets (env, never committed): `SLACK_WEBHOOK_URL`, `PAGERDUTY_ROUTING_KEY`, optional `ALERTMANAGER_SLACK_CHANNEL` (default `#arbibot-critical`). See `.env.production.example` (section "Alertmanager paging").
- Routing: `severity: critical` + `infrastructure` receivers → PagerDuty page + Slack; `warnings` / `paper-trading` / `dex` → Slack only. All alerts mirror to `arbibot-incidents` (→ reconciliation-service → `/incidents` UI) via `continue: true`.
- Fail-safe: if both paging secrets are empty, alertmanager falls back to an incidents-pipeline-only config (alerts appear in `/incidents` UI but are **not** paged) and logs a loud warning. `tools/validate-env.sh` warns when both are empty.
- Validation: `docker run --rm -v $(pwd)/infra/alertmanager/alertmanager.yml:/etc/alertmanager/config.yml prom/alertmanager:latest amtool check-config /etc/alertmanager/config.yml` (run against the **rendered** file, not the `.tpl`).
- Reload without restart: `curl -X POST http://localhost:9093/-/reload` (alertmanager runs with `--web.enable-lifecycle` in prod).

**Incident lifecycle:**
1. **Detection:** Alert fires → PagerDuty page → Slack notification
2. **Acknowledgement:** On-call engineer acknowledges in PagerDuty (5 min SLA)
3. **Investigation:** Check Grafana dashboards, logs, reconciliation mismatches
4. **Mitigation:** Execute runbook steps (manual approval, disable feature, rollback)
5. **Resolution:** Fix deployed, monitoring returns to normal
6. **Post-mortem:** Document in `/runbooks` within 24h (Section: What happened, Impact, Root cause, Timeline, Prevention)

**Histogram instrumentation (`@arbibot/nest-platform`):**
- **Metric:** `http_request_duration_seconds` (histogram) registered per service via `installMetricsOnFastify(fastify, { serviceName })`
- **Buckets:** `[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5]` (1ms through 5s)
- **Optional:** per-service tighter buckets can be added later via a second histogram name if Tier-1 SLO needs finer resolution than the default series
- **Alert calculation:**
  - p99: `histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))`
  - p95: `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))`
  - p50: `histogram_quantile(0.5, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))`
- **Migration status:** Phase 2 — histogram collection active; alerts migrated to quantiles; `arb_http_requests_total` deprecated for latency monitoring

## Analytics path latency (P4-4-CH)

**Scope:** Batch and operator tooling that does **not** sit on the Tier 1 evaluate / reserve / arm path — for example `npm run export:route-scoring-history`, future ClickHouse or DWH ETL, and replay workflows ([`docs/route-scoring-replay.md`](route-scoring-replay.md)).

These targets are **operational** (capacity / UX for analysts). They do **not** replace the **SLO and on-call (v1)** table above for critical sync APIs.

| Workload | Default target (staging; tune per deploy) | Notes |
|----------|-------------------------------------------|--------|
| JSONL export (`export-route-scoring-history.mjs`) | Wall-clock under **5 minutes** for **at most 50k** rows per run (default `LIMIT`) | Increase `LIMIT` only with owner/DBA agreement; for full-history analytics off OLTP see [`docs/adr-phase4-clickhouse-gate.md`](adr-phase4-clickhouse-gate.md). |
| `GET /policy/route-scoring-history/:routeKey` | Stay within **Read-only** Tier latency in the v1 table | If p99 degrades, reduce page size, add a read model, or open the CH gate. |
| Future CH / DWH load | ETL lag under **15 minutes** behind OLTP appends (initial default) | Read-only consumers only; no second writer to `route_scoring_history` on primary. |

## DEX Observability (DEX-1-2-OBS)

**Scope:** DEX execution pipeline — RPC providers, gas estimation, swap execution, transaction signing, broadcast, and confirmation. All metrics are emitted by `DexMetricsService` in `execution-orchestrator` and exposed on `GET /metrics`.

### DEX SLO Targets

| Metric | SLO | Target | Alert |
|--------|-----|--------|-------|
| `arb_dex_signature_seconds` p99 | Signing latency | < 100 ms | Page on-call if p99 > 100ms for 5m |
| `arb_dex_broadcast_seconds` p99 | Broadcast latency | < 200 ms | Page on-call if p99 > 200ms for 5m |
| `arb_dex_confirmation_seconds` p99 (mainnet) | On-chain confirmation | < 30 s | Ticket if p99 > 30s for 15m |
| `arb_dex_confirmation_seconds` p99 (testnet) | On-chain confirmation | < 10 s | Ticket if p99 > 10s for 15m |
| `arb_dex_swap_total` success rate | Swap success rate | > 95% over 5m | Page on-call if < 80% for 5m |
| `arb_dex_rpc_latency_seconds` p99 | RPC call latency | < 500 ms | Ticket if p99 > 1s for 10m |

### DEX Metrics Reference

| Metric Name | Type | Labels | Description |
|-------------|------|--------|-------------|
| `arb_dex_rpc_latency_seconds` | histogram | `chain_id`, `method` | DEX-specific RPC call latency |
| `arb_dex_gas_price_gwei` | gauge | `chain_id`, `type` (base_fee / priority_fee) | Current gas price per chain |
| `arb_dex_swap_total` | counter | `adapter`, `chain_id`, `status` (success / failed / reverted) | Swap outcomes by adapter |
| `arb_dex_confirmation_seconds` | histogram | `chain_id`, `network` (mainnet / testnet) | Time from broadcast to receipt |
| `arb_dex_signature_seconds` | histogram | `chain_id` | Transaction signing latency |
| `arb_dex_broadcast_seconds` | histogram | `chain_id` | Transaction broadcast latency |

### Bucket Reference

- **RPC latency:** `[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]` seconds
- **Confirmation:** `[1, 2, 5, 10, 15, 30, 60, 120, 300]` seconds
- **Signature:** `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5]` seconds
- **Broadcast:** `[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2]` seconds

### Grafana Dashboard

- **Dashboard:** `infra/grafana/dashboards/arbibot-dex-overview.json` (uid: `arb-dex-overview`)
- **Panels:** DEX health, swap success rate, RPC latency (p50/p95/p99), gas price, confirmation latency, signature/broadcast SLO, pool cache hit ratio, MEV detected

### Smoke Test

```bash
curl http://localhost:3012/metrics | grep arb_dex_
```

Expected: non-empty output with all 6 `arb_dex_*` metrics after the service starts and records at least one data point per metric.
