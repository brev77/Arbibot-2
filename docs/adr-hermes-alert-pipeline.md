# ADR: Hermes alert pipeline (Prometheus alerts → Telegram)

**Status:** accepted
**Date:** 2026-08-01
**Step:** `P7-7-HERMES-ALERTS` ([`.cursor/plans/DEVELOPMENT_PLAN7.md`](../.cursor/plans/DEVELOPMENT_PLAN7.md))
**Vector:** `REL` (вторичный `UX`) — [`docs/roadmap-vectors.md`](roadmap-vectors.md) initiative #18
**Supersedes:** partial — Slack paging removed from `alertmanager.yml.tpl` (P7-3)

## Context

Operator does not use Slack. The primary notification channel is **Hermes Agent
→ Telegram**. Before P7-7, two independent gaps prevented Prometheus alerts
(disk, ServiceDown, error-rate) from reaching the operator in Telegram:

1. **Routing gap (P7-3):** `DiskSpaceLow` (`infra/prometheus/alerts.yml`) had no
   data — `node_exporter` was absent (`TODO.md` M9). Slack was wired in the prod
   alertmanager template but unused; PagerDuty covered only `severity=critical`
   and only for `infrastructure`-route alerts (disk was routed to `warnings`).

2. **Structural gap (this ADR):** Alertmanager forwards alerts to
   reconciliation-service `POST /alerts/webhook` → table `alertmanager_incidents`
   (`apps/reconciliation-service/src/alerts/alerts.controller.ts:25`). But Hermes
   gateway `GET /hermes/v1/incidents` (`apps/hermes-gateway/src/hermes/hermes.controller.ts:175`)
   reads a **different** table — `reconciliation_mismatches`. **Hermes could not
   see Prometheus alerts at all.** Slack's presence masked this for deployments
   that used it; with Slack removed (P7-3) the gap became visible.

## Decision

Adopt a **pull-based pipeline** (Variant A from PLAN7 §P7-7), consistent with the
existing Hermes architecture (read-through gateway + cron-pulled MCP tools):

```
Prometheus → Alertmanager
   → reconciliation POST /alerts/webhook  →  alertmanager_incidents  (single-writer)
                                              │
Hermes Agent cron `alert_watch` (every 2 min, configurable)
   → MCP tool `list_alertmanager_incidents`
   → hermes-gateway GET /hermes/v1/alerts        (read-through, HermesAuthGuard)
   → reconciliation GET /alerts/incidents
   → agent summarizes NEW firing alerts (state in HERMES_MEMORY_PATH)
   → Telegram
```

### Why pull, not push

- **No new ingress path.** A push design (Alertmanager → hermes-gateway webhook)
  would add a new endpoint, a new state-bearing component, and a new dependency
  direction (external Alertmanager calling Hermes). The existing Hermes
  architecture is uniformly pull (cron + MCP over stdio + HTTP read-through).
  Pull reuses every established pattern.
- **Single-writer preserved.** Hermes gateway stays read-only — it does not
  write alerts; reconciliation-service remains the sole writer to
  `alertmanager_incidents`. No outbox/event bus is added.
- **Latency is acceptable.** A 2-minute poll interval is well within the
  operational window for the alerts in scope (disk fill, sustained error rate).
  PagerDuty (retained for `severity=critical`) provides the sub-minute page path
  for cases where 2 min is too slow.

### Components added

| Layer | File | Change |
|-------|------|--------|
| Gateway | `apps/hermes-gateway/src/hermes/hermes.controller.ts` | `GET /hermes/v1/alerts?status=` read-through → reconciliation `/alerts/incidents` |
| MCP | `packages/hermes-mcp-server/src/tools/alerts.ts` | `list_alertmanager_incidents` tool (+ registration in `tools/index.ts`) |
| Agent config | `tools/hermes-agent/hermes-config.yaml` | cron job `alert_watch` (interval `${ALERT_WATCH_INTERVAL:*/2 * * * *}`, `silent: true`) |
| Skill | `tools/hermes-agent/skills/investigate-alert.md` | summarize/dedupe firing alerts, map alertname → recommendation |
| CI guard | `tools/ci-hermes-agent-smoke.sh` | check #8 — P7-7 wiring (5 sub-checks) |

### Idempotency / noise control

The agent deduplicates against state in `HERMES_MEMORY_PATH`:
- a firing alert already notified is **not** re-sent within `repeat_interval` (4h);
- a transition to `resolved` triggers exactly one "✅ resolved" message;
- `silent: true` on the cron job suppresses the "no new alerts" case entirely.

## Consequences

- **Positive:** Operator receives Prometheus alerts in Telegram — the only
  channel used. Closes the structural gap regardless of Slack. Reuses existing
  patterns; no new stateful component.
- **Positive:** PagerDuty retained as a parallel critical-only channel — operator
  chose (P7-3) to keep it for redundancy on `severity=critical`.
- **Negative:** Up to 2-min detection-to-notification latency vs an instant push.
  Accepted: PagerDuty covers sub-minute critical paging; the Telegram path is
  the readable/summarized one, not the fastest.
- **Negative:** New MCP tool + endpoint to maintain. Mitigated by the CI wiring
  guard (`ci:hermes-agent-smoke` check #8) that catches a broken link the way
  the existing smoke caught the `hermes run` regression.

## Alternatives considered

- **Variant B (push):** Alertmanager → new hermes-gateway `POST /alerts/webhook`
  → Agent via SSE/queue. Rejected — adds ingress, state, and a new dependency
  direction; breaks the read-only gateway invariant for no clear benefit over
  PagerDuty's existing sub-minute path.
- **Outbox events from reconciliation on alert ingest:** rejected — would add an
  event producer for a single consumer (Hermes), violating the "don't add a bus
  for one subscriber" heuristic. The cron pull is simpler and sufficient.

## Manual runtime DoD

CI (`ci:hermes-agent-smoke`) verifies wiring statically. The real
Telegram round-trip needs secrets + the external `hermes` binary and is the
manual DoD (same pattern as Plan 5's `H5-G-RUNTIME`):
1. inject a firing alert (e.g. raise `DiskSpaceLow` threshold temporarily or
   POST a crafted payload to reconciliation `/alerts/webhook`);
2. confirm the operator's Telegram receives a summarized message within ~2 min;
3. resolve the alert; confirm a "✅ resolved" message.
