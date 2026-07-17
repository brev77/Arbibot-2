# Changelog

All notable changes to **Arbibot 2** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
**with phase suffixes** until 1.0: `v<major>.<minor>.<patch>-<phase>` where `<phase>`
is `paper` (paper-deploy baseline) or `live` (first live release). Pre-1.0 minors
may include breaking changes — read the **Changed** / **Removed** sections before bumping.

Release procedure: [`docs/release-process.md`](docs/release-process.md).

## [Unreleased]

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
