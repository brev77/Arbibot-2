# Grafana dashboard verification (manual)

Use during **CI stability / observability** sprints when Prometheus + Grafana are available (staging or local scrape).

## Import

1. Grafana: **Dashboards → New → Import** → upload from repo:
   - [`infra/grafana/dashboards/arbibot-risk-policy-writers.json`](../infra/grafana/dashboards/arbibot-risk-policy-writers.json) — watchlist/route writers + intake panels
   - Optionally: `arbibot-paper-trading.json`, `arbibot-execution-latency.json`, `arbibot-http-overview.json`
2. Bind the **Prometheus** datasource.

## Metrics smoke (Phase 4 + policy writers)

With **risk-service**, **market-intake-service**, and (optional) **openclaw-gateway** scraped:

| Expectation | Metric / check |
|-------------|----------------|
| Watchlist writer activity | Non-zero or recent `arb_watchlist_tier_*` rates after `POST /policy/jobs/watchlist-tiering` |
| Route scoring | `arb_route_scoring_*` and histogram `arb_route_scoring_score_distribution_*` |
| Intake throttling | `arb_intake_*` when throttling / tier routing runs |
| OpenClaw Redis issues | `arb_openclaw_safe_mode_redis_errors_total` stays **zero** in healthy Redis; spikes during simulated Redis outage |

## Troubleshooting

- **Empty panels:** confirm `service` label matches scrape config (`openclaw-gateway`, `risk-service`, `market-intake-service`).
- **JSON import errors:** Grafana major version should accept dashboard JSON v2; re-export from a working Grafana if schema drift occurs.
