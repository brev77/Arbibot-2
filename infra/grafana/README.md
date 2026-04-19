# Grafana dashboards (P2-2.3-GRAF)

JSON dashboards in [`dashboards/`](dashboards/) target **Prometheus** scraping Nest services (`GET /metrics` via `@arbibot/nest-platform` → histogram `http_request_duration_seconds` and counter `arb_http_requests_total`, each with a `service` label).

## Import

1. Grafana: **Dashboards → New → Import** → upload `dashboards/arbibot-http-overview.json`.
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

Node default metrics (`process_*`, `nodejs_*`) are also registered by `prom-client` `collectDefaultMetrics`.
