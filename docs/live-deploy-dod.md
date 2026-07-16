# Live-deploy Definition of Done (DoD) — minimal-capital go-live gate

**Status:** **blocked** — awaiting product-owner decision + testnet soak. This document
is the checklist an operator runs through before flipping `dex.live` to production with
real (minimal) capital. It is referenced from
[`.cursor/plans/deploy-readiness/D4-C-4-LIVE-SMOKE.md`](../.cursor/plans/deploy-readiness/D4-C-4-LIVE-SMOKE.md).

**Canonical principle (from [`DEVELOPMENT_PLAN.md`](../.cursor/plans/DEVELOPMENT_PLAN.md),
«Операционная последовательность первичного запуска»):** paper trading is a mandatory
end-to-end stack test (data → opportunity → risk → capital → virtual execution →
observability/UI) that accumulates statistics **without real losses**; after acceptance,
live is enabled with minimal capital.

## Gate 1 — code controls (Plan 4 Phases A + B + C)

All capital-critical controls must be enforced **in backend code**, not only in docs or seed.

- [x] **D4-B-1-KILLSWITCH** — `DexKillSwitchService.assertLiveNotHalted()` before every live leg; `DEX_LIVE_KILL_SWITCH` env override + `dex.limits.killSwitch` config; fail-closed in prod; metric `arb_dex_live_halt_active`.
- [x] **D4-B-2-LIMITS** — `dex.limits`/`dex.live` consumed by backend; `evaluateTrade()` wired in 5 live DEX adapters; `recordTradeVolume()` after `tx.wait()`; daily volume persisted (migration 039).
- [x] **D4-B-3-CEILING** — Aggregate capital ceiling (reservations + open positions) enforced with `FOR UPDATE` subquery.
- [x] **D4-B-4-KEYS** — Wallet keys in DB (`wallet_keys`, migration 042); no long-lived in-memory `ethers.Wallet`; `KeyVaultService` sole decrypt path.
- [x] **D4-B-5-BRIDGE** — Real bridge finality + destination delivery verification (migration 043 finality columns).
- [x] **D4-B-6-MTLS** — Service-to-service auth enforced (`signedFetch` in 11 clients; `HERMES_SIGN_UPSTREAM`; `validate-env` blocks deploy without auth).
- [x] **D4-B-7-SECRET-SCAN** — `secret-scan` CI job **blocking** (`continue-on-error: false`).
- [ ] **D4-B-8-TWO-PERSON** — **DESCOPED** by product-owner (single-operator profile). Mitigations retained: single-operator typed-phrase in `DestructiveOperatorAction`, audit records for all destructive ops, kill-switch, capital ceiling. If multi-operator/compliance requires it later, reopen the step.
- [x] **D4-B-9-IMPORT-GRAPH** — `paper-live-boundary` CI job (blocking, PL.1/PL.2 grep).
- [x] **D4-C-1-LOGGING** — Structured NDJSON logging (pino) in all 12 services; redaction (K1.1/K1.2); Promtail JSON pipeline.
- [x] **D4-C-2-VERSIONING** — `CHANGELOG.md` + semver git tags + GHCR semver image tags (`type=ref,event=tag`); `docs/release-process.md`.
- [x] **D4-C-3-PANIC** — Unified panic-button: CLI (`npm run panic:stop`/`panic:recover`) + UI (⛔ EMERGENCY STOP) + backend (`/policy/system/panic-*`). Recovery requires typed-confirm + audit.

## Gate 2 — operational readiness

- [ ] **Backup + restore drill** (D4-A-3-RESTORE) executed and verified on a production-shape DB.
- [ ] **Panic-button tested** (D4-C-3): `npm run panic:stop` → verify `arb_dex_live_halt_active=1` and live legs blocked; `npm run panic:recover` → verify resume.
- [ ] **Operator on-call runbook review:** on-call operator confirms readiness per [`docs/incident-response-playbook.md`](incident-response-playbook.md).
- [ ] **Observability:** Loki queries verified (`{service="execution-orchestrator",level="error"}`); Grafana dashboards load; Alertmanager paging receiver tested (D4-A-2-PAGING).
- [ ] **TLS** (D4-A-6-TLS): valid certificates; HSTS enforced (`applyArbibotHttpSecurity`).
- [ ] **Migrations applied:** `npm run db:verify-migrations:all` confirms 001–043.

## Gate 3 — testnet soak (≥ 24h, no capital loss)

- [ ] **Paper→live bridge transfers:** minimum 10 transfers through testnet bridges (Across / Stargate / Native L2) with zero loss and correct destination delivery (D4-B-5 finality verification).
- [ ] **Reconciliation:** 0 unreconciled mismatches over a 24h testnet run (`GET /mismatches` clean).
- [ ] **Capital rehearsal:** reserve → execute → reconcile on a minimal sum (≤ $10) on testnet.
- [ ] **Kill-switch drill mid-soak:** trigger panic-button during the run; confirm new live legs blocked, in-flight legs complete, reconciliation clean after recovery.

## Gate 4 — go-live sign-off

- [ ] **Product-owner approval** to enable live with minimal capital.
- [ ] **`dex.live.enabled=true`** + **`dex.live.liveEnabled=true`** promoted via config-service (operator-approved, audited). `dryRunMode` flipped to `false` **only** at this point.
- [ ] **First live trade** monitored end-to-end (opportunity → risk → capital → execution → portfolio → reconciliation → audit); all events present.
- [ ] **Smoke result recorded** in `docs/live-deploy-smoke-<date>.md`.

## Rollback (if any gate fails)

`npm run panic:stop` (D4-C-3) → halt trading → rollback images to previous semver tag (`IMAGE_TAG=v<prev>`, D4-C-2) → restore DB if a migration was applied (`npm run db:restore`, D4-A-3) → triage via [`docs/reconciliation-p0-procedures.md`](reconciliation-p0-procedures.md).
