# Phase 4 UI — degraded signals ([`P4-4-UI`](../.cursor/plans/DEVELOPMENT_PLAN.md))

Sketch of **operator-visible** degradation before full UI implementation. Sources are **read-only**; mutations stay on existing approval flows.

## Signal catalog (v0)

| Signal | Meaning | Source (v0) | Suggested UI placement |
|--------|---------|---------------|-------------------------|
| `RiskPolicyWritersStale` | No `arb_watchlist_tier_changes_total` / `arb_route_scoring_changes_total` increase over **2×** writer interval while jobs enabled | Prometheus (derivatives on counters) | `/settings` banner near policy inspection |
| `IntakePolicyFallback` | Intake using baseline policy because risk/config fetch failed | Metric `arb_intake_policy_fallback_total` + `GET /health/degradation` on **market-intake** proxied by BFF `GET /api/operator/health/degradation` | `/dashboard` + operator layout banner |
| `RiskApiUnavailable` | BFF cannot reach `RISK_API_BASE` for policy reads | BFF health or synthetic check | Global operator banner |
| `ScoreDistributionFlat` | Histogram `arb_route_scoring_score_distribution` shows no spread (possible model/data issue) | Grafana alert (optional) | `/settings` footnote |

## UX principles

- **Read-only:** degraded banners **never** auto-mute trading; they inform the operator.
- **Two-tier severity:** *warning* (observability-only) vs *action* (links runbook / incidents).
- **Correlation:** prefer `correlation_id` / `service` labels already on HTTP metrics.

## Implementation order

1. Grafana alerts for writer counter staleness (pairs with [`arbibot-risk-policy-writers.json`](../infra/grafana/dashboards/arbibot-risk-policy-writers.json)).
2. BFF aggregation endpoint (optional) `GET /api/operator/health/policy-writers` reading cached Prometheus or last-success timestamps — **only if** product wants UI without Grafana.

## References

- [`docs/phase4-prep-bridge.md`](phase4-prep-bridge.md)
- [`docs/adr-phase4-intake-throttling.md`](adr-phase4-intake-throttling.md)
