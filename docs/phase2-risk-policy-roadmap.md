# Phase 2.2 policy roadmap (`P2-2.2-PROF`, `P2-2.2-ADRISK`, `P2-2.2-PLAY`)

## Current checkpoint

- `risk-service` exposes **`GET /policy/phase2-readiness`** (static JSON) so operators and CI can probe that the HTTP surface exists before TokenProfile tables and adaptive engines land.
- Canonical execution work (`P2-2.1-EPL`) must stay ahead of production playbooks: playbooks assume instrumented legs and venue feedback.

## Intended sequencing

1. **`P2-2.2-PROF`** — PostgreSQL tables + read API for `TokenProfile` / `RouteProfile`; risk evaluation reads profiles; no silent defaults that bypass risk limits.
2. **`P2-2.2-ADRISK`** — configurable modes and dynamic sizing; tests for boundary sizing; still single-writer on `RiskDecision`.
3. **`P2-2.2-PLAY`** — orchestrator hooks partial fill / hedge / unwind with metrics; depends on `P2-2.1-EPL` + venue path.

## Invariants

- Reservation-first and audit on any operator-visible mutation.
- OpenAPI / `@arbibot/contracts` route mirrors updated whenever public paths change.
