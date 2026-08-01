# Changelog

All notable changes to **Arbibot 2** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
**with phase suffixes** until 1.0: `v<major>.<minor>.<patch>-<phase>` where `<phase>`
is `paper` (paper-deploy baseline) or `live` (first live release). Pre-1.0 minors
may include breaking changes — read the **Changed** / **Removed** sections before bumping.

Release procedure: [`docs/release-process.md`](docs/release-process.md).

## [Unreleased]

### Fixed
- **D4-B-6-MTLS** — `tools/validate-env.sh` now **fails** (exit 1) when `ARBIBOT_SERVICE_AUTH_ENABLED != 'true'`, instead of warning. Previously a prod-deploy with service auth disabled passed validation with warnings only, contradicting the documented guarantee in `docs/live-deploy-dod.md` and the step's own acceptance. Verified: auth-disabled env → `FAIL: 1, exit 1`; auth-enabled env → `PASS, exit 2`.
- **Migration 050 — paper AutoDrive pipeline stall (production hotfix).** `paper_capital_reservations` had an over-broad `UNIQUE (instrument_key, state)` constraint (migration 021, `DEFERRABLE INITIALLY DEFERRED`). Because `state ∈ {active, expired}` and `PaperCapitalService.expireReservation()` leaves the row in place (history), the table allowed at most **one** `expired` row per instrument. When a later trade for that same instrument tried to settle, its `active → expired` UPDATE collided with the pre-existing `expired` row at COMMIT — `duplicate key value violates unique constraint "paper_capital_reservations_instrument_key_state_key"` — so `settle()` threw before moving the trade to `settled`, leaving it stuck in `active`. Phase C retried every ~5s, same failure each time. The stuck `active` trades then saturated the AutoDrive Phase B concurrency cap (`PAPER_AUTO_DRIVE_MAX_CONCURRENT_TRADES` counts only `active`), so drafts were never promoted to `active` either — the two reported symptoms ("зависшие сделки" + "новых сделок нет") were one cascading bug. **Fix:** migration 050 drops the composite constraint and adds a partial unique index `WHERE state = 'active'`, matching the original inline comment ("Ensure only one active reservation per instrument") and the already-declared `@Index(['instrumentKey', 'state'], { where: "state = 'active'" })` on the entity. Self-healing — no manual backfill: the next Phase C tick retries `expireReservation` on each stuck trade, the UPDATE now succeeds, the trades settle, and Phase B headroom is released.
- **Paper trade / capital reservation atomicity (follow-up to migration 050).** The reservation reserve (in `approve`) and expiry (in `settle`/`cancel`) used to run in their own transactions, *before* the trade state transition — so a version-CAS failure on the trade left an inconsistent state: in `approve`, an orphaned `active` reservation blocked the instrument forever (no TTL worker is wired up); in `settle`/`cancel`, an `expired` reservation while the trade stayed `active`. **Fix:** `approve`/`cancel`/`settle` now reserve/expire the reservation *inside* the same `pessimistic_write` transaction as the trade state change — both writes commit or roll back together (the trade↔reservation invariant is now provable, verified end-to-end on Postgres 16). Reservations are additionally bound to the trade via `tradeId` (the `trade_id` FK + partial index from migration 021, now populated by `reserveCapital`), and `getActiveReservation` looks up by `tradeId` rather than by `instrumentKey`. `PaperCapitalService.{reserveCapital,getActiveReservation,expireReservation}` accept an optional `EntityManager` to participate in the caller's transaction (existing repo-pattern convention from `dex-outbox-events`/`legs`/`outbox-relay`). A concurrent `approve()` of a second trade with the same instrument now surfaces as a typed `ConflictException` (409) instead of an opaque 500; `AutoDriveWorker` Phase B detects it via `instanceof ConflictException` (string fallback kept). 4 new atomicity unit tests; 242/242 service tests green.
- **AutoDrive Phase 0 auto-promote goes through the service (paper→live gate hardening).** `AutoDriveWorker` Phase 0 (`queued → under_review → promoted`, opt-in via `PAPER_AUTO_PROMOTE`) previously wrote directly to the candidates repo with no row lock, no version CAS, no eligibility gate, and no audit — unlike the operator `approve()` path it paralleled. **Fix:** added `PaperPromotionService.autoPromote(em?, id, actor)`, which runs the two-step transition (`queued→under_review→promoted`; the allow-list forbids `queued→promoted` directly) inside one `pessimistic_write` transaction with version CAS, applies the **same drift/score eligibility gate** as operator approve (env `PAPER_PROMOTION_MAX_DRIFT_BPS` / `PAPER_PROMOTION_MIN_SCORE`), and writes audit records (`paper_promotion_candidate_auto_promoted` / `..._auto_rejected`). An ineligible candidate is routed `queued→under_review→rejected` and audited rather than silently promoted; the call is idempotent on repeat ticks (a candidate already past `queued` returns `skipped`). Phase 0 now delegates to this method and maps the outcome to metrics (`auto_promoted` / `auto_rejected_eligibility` / `skipped_not_queued`). **Behavior change:** auto-promote now enforces the drift/score gate, so candidates that previously promoted despite high drift / low score are now rejected — an intentional strengthening of the paper→live boundary. 4 new Phase 0 unit tests (the phase was previously untested); 246/246 service tests green. Phase -1's direct repo `reject` writes (a terminal, lower-risk symmetric case) are intentionally left as-is for a separate pass.

### Added
- **D4-C-1-LOGGING** — Structured NDJSON logging via `PinoLoggerService` (`@arbibot/nest-platform`), wired into all 12 Nest service `main.ts` files via `configureArbibotLogger`. Fields: `level`, `time` (ISO-8601), `service`, `correlationId`, `context`, `msg`. Sensitive-field redaction (K1.1/K1.2). Env: `LOG_LEVEL`, `ARBIBOT_LOG_PRETTY`. Promtail pipeline updated; Loki queries documented in `docs/observability-tracing.md`.
- **D4-C-2-VERSIONING** — `CHANGELOG.md` (Keep-a-Changelog), `package.json` version `0.1.0`, semver git tag `v0.1.0-paper` (annotated), `docs/release-process.md`. Pre-1.0 contract: `v<major>.<minor>.<patch>-<phase>` (`paper`/`live`).
- **D4-C-3-PANIC** — Unified emergency-stop / panic-stop: `npm run panic:stop` (`tools/panic-button.sh`) flips `DEX_LIVE_KILL_SWITCH=true` via config-service + UI banner; `npm run panic:recover` (`tools/panic-recover.sh`) clears it.
- **D4-C-4-LIVE-SMOKE** — Live-deploy DoD checklist (`docs/live-deploy-dod.md`). **Status: blocked** — awaiting product-owner sign-off + 24h testnet soak.
- **Plan 5 — Hermes Agent GLM 5.2 + Telegram** — agent rewired from NousResearch to GLM 5.2 (Z.AI, OpenAI-compatible `base_url`, `provider: openai`); personal Telegram bot for operator (`HERMES_TELEGRAM_ENABLED`, whitelist `OPERATOR_TELEGRAM_ID`); new skill `explain-bot` (explains bot operation in Russian); npm scripts `build:hermes-mcp` / `doctor:hermes` / `run:hermes` / `dev:stack:hermes-agent`; docker profile `hermes-agent`. See `docs/adr-hermes-agent-glm-telegram.md`, `.cursor/plans/DEVELOPMENT_PLAN5.md`.

### Documentation
- **Documentation audit (2026-07-17)** — full refresh of ~30 files after D4 deploy-readiness: migration range `001–036` → `001–043`, real quality metrics on `df2177a` (Build 22/22, Lint 29/29, Tests 778/778 in 74 suites), `hermes` casing unified, 5 stale deploy docs marked SUPERSEDED by `paper-deploy-dod.md` / `live-deploy-dod.md`, D4 plan acceptance checkboxes synced with code. Report: `docs/documentation-audit-2026-07.md`.
- New `docs/DOCUMENTS_INDEX.md` — unified clickable index of ~160 project documents.

### Changed
- Promtail image pinned to `3.3.2` in both dev and prod compose (was drifted 3.2.1 dev / 3.3.2 prod).

## [0.1.0-paper] — 2026-07-16

**Paper-deploy baseline.** The system is feature-complete for paper trading; all formal steps of Plans 1–3 and DEX (1+2+DOC) are done. This tag marks the point from which the Plan 4 deployment-readiness gate (Phases A/B/C) closes capital-critical blockers before any live capital is committed. See [`docs/deployment-readiness-review-2026-07.md`](docs/deployment-readiness-review-2026-07.md).

### Added — Plan 4 Phase B (live-gate controls, real backend enforcement)
- **D4-B-1-KILLSWITCH** — Real DEX live kill-switch in `execution-orchestrator` (`DexKillSwitchService`). `DEX_LIVE_KILL_SWITCH` env override + `dex.limits.killSwitch` config; fail-closed in production; metric `arb_dex_live_halt_active`.
- **D4-B-2-LIMITS** — `dex.limits` / `dex.live` consumed by backend. `evaluateTrade()` wired into all 5 live DEX adapters (Uniswap V2/V3, Sushi, Pancake, Biswap); `recordTradeVolume()` after successful `tx.wait()`; daily volume persisted to `dex_daily_volume` (migration 039). `PaperDexAdapter` structurally isolated.
- **D4-B-3-CEILING** — Aggregate capital ceiling (reservations + open positions) enforced with `FOR UPDATE` subquery in `capital-service`.
- **D4-B-4-KEYS** — Wallet keys persisted in DB (`wallet_keys`, migration 042); removed long-lived in-memory `ethers.Wallet` cache (K1.2). `KeyVaultService` is the sole decrypt path.
- **D4-B-5-BRIDGE** — Real bridge finality + destination delivery verification. Finality constants + Outbox/Portal/LZ ABIs + native-bridge registry; migration 043 adds finality columns on `bridge_transfers`.
- **D4-B-6-MTLS** — Service-to-service auth enforced: `signedFetch` wired into 11 internal service clients; `HERMES_SIGN_UPSTREAM` env-gated signing; `validate-env` blocks deploy without auth.
- **D4-B-7-SECRET-SCAN** — `secret-scan` CI job now **blocking** (`continue-on-error: false` removed). K1/K2 grep guard holds at zero findings.
- **D4-B-9-IMPORT-GRAPH** — CI paper/live import-graph boundary gate (`tools/ci-paper-live-boundary.sh`): enforces PL.1/PL.2 from `dex-security-and-capital-safety` skill. New `paper-live-boundary` CI job (blocking, pure grep).

### Added — Plan 4 Phase A (paper-deploy gate)
- **D4-A-1-AUTH** — Operator auth (JWT session cookie `arbibot_session`, HS256, role model viewer/operator/admin, RBAC in BFF middleware).
- **D4-A-2-PAGING** — Real Alertmanager paging receiver.
- **D4-A-3-RESTORE** — Backup + restore procedure (`npm run db:backup` / `db:restore`).
- **D4-A-4-MIGRATIONS** — Migration collision 037 resolved; prod procedure documented.
- **D4-A-5-PROBES** — `/ready` vs `/live` probes split for Kubernetes-style orchestration.
- **D4-A-6-TLS** — TLS certificates + HSTS (`applyArbibotHttpSecurity`, `npm run generate:tls`).
- **D4-A-7-PAPER-SMOKE** — Paper-deploy DoD checklist.

### Added — DEX (Phase 4 + DEX-1 + DEX-2 + DEX-DOC)
- 3 bridge adapters (Across, Stargate, Native L2) + `MultiLegPlanBuilder` + `CrossChainReconciliationService` + worker. Multi-chain E2E (`npm run e2e:dex2-multichain`).
- DEX opportunity filters (`applyDexFilters`, `previewDexFilters`, `getDexFiltersMetrics`).
- `@arbibot/contracts-eth` (ethers v6, ABIs UniV2/V3/Sushi + ERC20, addresses Arbitrum/Base/BNB).
- DEX runbook + rollback strategy docs.

### Added — Hermes (Plan 3)
- `apps/hermes-gateway/` (NestJS + Fastify, port 3020) — operator API gateway with read-through + mutation endpoints, `HermesAuthGuard`, safe-mode (Redis-backed).
- `packages/hermes-mcp-server/` — TypeScript MCP server (14 tools) over stdio → Hermes Gateway.
- `tools/hermes-agent/` — config for external Hermes Agent (NousResearch) + 6 Russian-language skill prompts.

### Added — Phase 4 (intake throttling + degraded signals)
- `IntakeThrottleService`, `PolicyCacheService`, `DegradationStateService` (market-intake-service); `GET /health/degradation`; config keys `intake.throttling`, `intake.routing.tiers`.
- Operator UI degraded-status banner (polling 30s, dismissible).

### Added — Phase 3 (paper trading)
- `paper-trading-service` (port 3018): paper trades, promotion candidates, drift samples, discovery candidates. Virtual capital reservations (isolated from live). Drift gauges + recording rules + Grafana dashboard.
- Paper discovery pipeline (worker + config-service integration on `paper.discovery` key).
- E2E + CI: paper promotion relay, paper discovery.

### Added — Phase 2 (controlled execution)
- HTTP venue + lab stand; risk profiles (`token_profiles`, `route_profiles`); policy writer jobs (`WatchlistTieringWriterService`, `RouteScoringWriterService`); partial-fill playbooks (`playbook_config`).
- Reconciliation P0 procedures; SLO v1 + on-call doc.

### Added — Phase 1 (foundation)
- 12 NestJS backend services on Fastify + TypeORM (PostgreSQL) + Next.js `apps/web` (13 apps total). `@arbibot/persistence`, `@arbibot/messaging`, `@arbibot/nest-platform`, `@arbibot/outbox-kafka-bridge`, `@arbibot/contracts-eth`, `@arbibot/hermes-mcp-server`.
- Outbox relay (opportunity → paper-trading over HTTP); Kafka bridge (publishes `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted`).

### Added — Observability + security
- Prometheus metrics per service (`installMetricsOnFastify`); OpenTelemetry traces (opt-in via OTLP env).
- `secret-scan` CI guard (K1/K2 static grep), `paper-live-boundary` CI guard (PL.1/PL.2).
- gitleaks value-guard + Trivy container scan + CodeQL SAST + Checkov IaC in `security.yml`.

### Changed
- Direct-to-main commit policy enforced (feature branches optional, structured commits with `step_id`).
- `@arbibot/contracts` consolidated types across services.

### Fixed
- Migration 020 rollback path repaired via 024; migration 034 `OnChainTransaction.legId` bigint→uuid.
- 51 Dependabot vulnerabilities resolved to 0; lockfile deduplicated.
- `@nestjs/cli` hoisted to root (fixes `nest start` on Windows).

### Descoped
- **D4-B-8-TWO-PERSON** — Backend two-person approval for destructive operations. Cancelled by product-owner decision (single-operator profile). Existing controls retained: single-operator typed-phrase (`DestructiveOperatorAction`), audit records, kill-switch, capital ceiling. Recovery (`D4-C-3-PANIC`) adapted to typed-confirm + audit instead of two-person.

[Unreleased]: https://github.com/brev77/Arbibot-2/compare/v0.1.0-paper...HEAD
[0.1.0-paper]: https://github.com/brev77/Arbibot-2/releases/tag/v0.1.0-paper
