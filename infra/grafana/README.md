# Grafana dashboards (P2-2.3-GRAF)

JSON dashboards in [`dashboards/`](dashboards/) target **Prometheus** scraping Nest services (`GET /metrics` via `@arbibot/nest-platform` → counter `arb_http_requests_total`).

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
| `arb_http_requests_total` | `method`, `route`, `status_code` | Emitted per Fastify response |

Node default metrics (`process_*`, `nodejs_*`) are also registered by `prom-client` `collectDefaultMetrics`.
