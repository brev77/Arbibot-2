# Grafana dashboards (P2-2.3-GRAF)

JSON dashboards in [`dashboards/`](dashboards/) target **Prometheus** scraping Nest services (`GET /metrics` via `@arbibot/nest-platform` → histogram `http_request_duration_seconds` and counter `arb_http_requests_total`, each with a `service` label).

## Import

1. Grafana: **Dashboards → New → Import** → upload `dashboards/arbibot-http-overview.json` (and optionally `arbibot-risk-policy-writers.json`, `arbibot-paper-trading.json`, `arbibot-execution-latency.json`).
2. Select Prometheus datasource when prompted (or set datasource UID to match your stack).

## Optional provisioning (Docker)

Mount this tree into Grafana:

- `/etc/grafana/provisioning/dashboards/dashboards.yaml` (list `dashboards/*.json`)
- `/var/lib/grafana/dashboards/` ← copy JSON files

See [Grafana provisioning](https://grafana.com/docs/grafana/latest/administration/provisioning/).

## Metrics reference

| Metric | Labels | Notes |
|--------|--------|--------|
| `http_request_duration_seconds` | `method`, `route`, `status_code`, `service` | Latency per response |
| `arb_http_requests_total` | `method`, `route`, `status_code`, `service` | Request count per response |
| `arb_watchlist_tier_evaluations_total` | — | Watchlist tier writer passes (risk-service policy jobs) |
| `arb_watchlist_tier_changes_total` | — | Append-only tier snapshots persisted |
| `arb_route_scoring_evaluations_total` | — | Route scoring writer passes |
| `arb_route_scoring_changes_total` | — | Append-only scoring rows persisted |
| `arb_route_scoring_score_distribution_*` | histogram buckets | Persisted route scores (0..1) |
| `arb_intake_throttled_snapshots_total` | `reason` | Ingest skipped by sampling / score gate (market-intake) |
| `arb_intake_policy_fallback_total` | — | Config/risk policy bundle refresh failed |
| `arb_intake_routing_count` | `tier` | Throttle evaluation by resolved tier |
| `arb_intake_policy_cache_hit_total` / `arb_intake_policy_cache_miss_total` | `layer` | Policy bundle cache |
| `arb_openclaw_safe_mode_redis_errors_total` | `operation` (`connection`, `get`, `set`) | Redis errors in OpenClaw safe mode ([`docs/openclaw-safe-mode-runbook.md`](../../docs/openclaw-safe-mode-runbook.md)) |

See dashboard `dashboards/arbibot-risk-policy-writers.json` for PromQL examples (includes **market intake** panels next to risk policy writers).

See [`docs/grafana-dashboard-verification.md`](../../docs/grafana-dashboard-verification.md) for a manual import / smoke checklist.

Node default metrics (`process_*`, `nodejs_*`) are also registered by `prom-client` `collectDefaultMetrics`.
