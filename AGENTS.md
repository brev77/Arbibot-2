
# Arbibot 2

## Cursor / agent instructions

### Arbibot 2 Cursor Skills

The repo uses custom Cursor skills in `.cursor/skills/` for architecture validation and code reviews:

1. **architecture-guard-agent** — validates changes against Arbibot 2 system architecture
   - Path: `.cursor/skills/architecture-guard-agent/SKILL.md`
   - Checks: service boundaries, single-writer, reservation-first, outbox/inbox, reconciliation, paper/live isolation, operator approval for destructive actions, OpenAPI/AsyncAPI consistency
   - Triggers: architecture review, guard check, boundary review, invariant check, ADR review
   - Usage: Run via `/architecture-guard` or when prompted by the system

2. **backend-review-agent** — reviews backend code against Arbibot 2 architecture
   - Path: `.cursor/skills/backend-review-agent/SKILL.md`
   - Checks: NestJS/Fastify services, OpenAPI/AsyncAPI/schema review, single-writer patterns, reservation-first, outbox/inbox, ExecutionPlan state machine, event envelopes
   - Triggers: backend review, PR review, risk service review, contracts review, approve backend PR
   - Usage: Run via `/backend-review` or when requested for backend code review

3. **frontend-review-agent** — reviews frontend code against Arbibot 2 conventions
   - Path: `.cursor/skills/frontend-review-agent/SKILL.md`
   - Checks: Next.js/React review, operator dashboard PR, App Router, React Query, Zustand, shadcn/ui, TanStack Table, operator safety, RBAC, destructive action flows
   - Triggers: frontend review, dashboard review, UI review, operator UX, RBAC review
   - Usage: Run via `/frontend-review` or when requested for frontend code review

4. **git-workflow-agent** — manages Git operations in the Arbibot 2 monorepo
   - Path: `.cursor/skills/git-workflow-agent/SKILL.md`
   - Checks: **direct-to-main commit policy** (commits/pushes go straight to `main`; feature branches are optional, not required), structured commits linked to plan step_ids, scoped pre-commit validation (build/lint/test for code; `verify:env` for config; none for docs/plans), optional branch naming conventions, conflict resolution, error recovery, Windows path safety, forbidden operations
   - Triggers: git commit, git push, git branch, git merge, git rebase, conflict resolution, git fix, git error, prepare PR, sync branch
   - Usage: Run via `/git-workflow` or automatically on Git operations

5. **dex-security-and-capital-safety** — hardens DEX, on-chain, and cross-chain flows against capital loss and key compromise
   - Path: `.cursor/skills/dex-security-and-capital-safety/SKILL.md`
   - Checks: threat model for private key leakage (K), on-chain tx replay/MEV/slippage/overflow (T), bridge replay/timeout/finality (B), capital exposure/kill-switch/paper-live contamination (C), token approval leakage (A); RED-zone gating with operator approval; paper→live boundary import-graph contract
   - Triggers: DEX security review, capital safety check, wallet/key review, bridge adapter review, slippage/approval review, paper→live promotion review, on-chain tx audit
   - Usage: Run via `/dex-security` or automatically when touching `KeyVaultService`, `WalletManagerService`, `*BridgeAdapter`, `BridgeTransferService`, `MultiLegPlanBuilder`, `SlippageProtectionService`, `on_chain_transactions`, `approvals`, `dex.limits`/`dex.live` config, or any paper→live promotion boundary
   - References: `references/threat-model.md` (exploit-сценарии + remediation), `references/paper-live-boundary.md` (import-graph контракт изоляции)

**Workflow:** When making changes that cross service boundaries or involve critical flows, use architecture-guard-agent before committing. For PR reviews, use backend-review-agent or frontend-review-agent based on the code area. For any change touching DEX, wallets, keys, bridges, capital limits, or paper→live boundaries, additionally use dex-security-and-capital-safety to catch capital/key-loss vectors that generic OWASP checks miss. **For all Git operations (committing, pushing, branching, merging, conflict resolution, PR preparation), use git-workflow-agent** to ensure structured commits, scoped pre-commit validation, and direct-to-main workflow (feature branches are optional).

### graphify (knowledge graph)

The repo uses [graphify](https://github.com/safishamsi/graphify): `graphify-out/` is listed in `.gitignore` and is generated locally, not committed.

**Current graph state (2026-07-17, code-only AST refresh):** **1974** nodes, **2031** edges, **468** communities — details in `graphify-out/GRAPH_REPORT.md` (556 files scanned, ~338K words). ⚠️ **Full LLM-rebuild pending** — code-only covers `.ts` imports/structure but does not index markdown/docs or add semantic edges; run `/graphify .` in Cursor after large doc changes to refresh the full graph (doc↔code cross-references).

**Full guide:** [`docs/graphify-guide.md`](docs/graphify-guide.md) — установка, команды, сценарии, интерпретация отчёта.

#### npm-скрипты

| Скрипт | Назначение |
|--------|-----------|
| `npm run graphify:rebuild` | AST-only rebuild графа (~30 сек) |
| `npm run graphify:query -- "вопрос"` | Query к графу |
| `npm run graphify:report` | Показать GRAPH_REPORT.md |

#### Установка

```bash
pip install graphifyy
python -m graphify cursor install   # создаёт .cursor/rules/graphify.mdc
```

#### Прямые команды

- **Code-only refresh (AST, no LLM):** `py -3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` — updates `graphify-out/graph.json`, `GRAPH_REPORT.md`, and cache. On Windows use **`py -3`** instead of `python`.
- **Full graph (docs, markdown, images, semantic edges):** in Cursor run `/graphify .` (skill); after large doc changes use `/graphify . --update`.
- **Focused questions:** `py -3 -m graphify query "<question>" --graph graphify-out/graph.json`

#### CI integration

GitHub Actions job `graphify-check`: runs after `build`, rebuilds graph, uploads `GRAPH_REPORT.md` as artifact (7-day retention, non-blocking).

#### Когда использовать

- **Before planning/implementing a step** — `graphify:query` для навигации по коду шага (callers, single-writer boundaries, affected communities) **до** запуска тяжёлых Explore-агентов. Это снижает расход токенов: graphify-query стоит ~0 токенов (локальный AST-grep), тогда как Explore-агенты — десятки-сотни K токенов. Graphify покрывает навигацию (где код, какие файлы в community), Explore-агенты оставлять для семантических задач (понять поведение, спроектировать подход). Рабочий процесс: `graphify:rebuild` (если watch-хук не сработал) → `graphify:query` → точечное чтение нужных функций (не целых файлов).
- Before architecture reviews and `/review-step`
- After major refactors or shared-package changes
- When validating `single-writer`, `reservation-first`, and shared-package boundaries
- Before deployment: `npm run graphify:rebuild` + check report

### Overview

**Domain glossary:** [`CONTEXT.md`](CONTEXT.md) — единый канон доменных терминов (ubiquitous language): architectural invariants, trading/execution, capital, DEX, on-chain/wallet, bridge, risk, paper quality, events, config/ops, reconciliation, HERMES, chain/token types. Используй при обсуждении доменных flows для согласованности терминологии; обновляй inline при разрешении новых терминов. `CONTEXT.md` (что термины значат) и этот `AGENTS.md` (как запускать/настраивать) не перекрываются.

Arbibot 2 is a **Turborepo monorepo** (`npm` workspaces: `apps/*`, `packages/*`):

- **Backend:** multiple NestJS HTTP services on **Fastify** + **TypeORM** (PostgreSQL), optional Redis, Prometheus metrics via `@arbibot/nest-platform`.
- **Operator UI:** Next.js App Router in **`apps/web`** (`@arbibot/web`).

There is **no** `core-backend/` or `operator-frontend/` directory; older docs or audits may refer to that layout.

**Current status (2026-07-16):**

**Проект feature-complete.** Все формальные шаги планов 1–5 + DEX выполнены; фаза **D4 deploy-readiness** (Plan 4) доставлена (20/22 done + D4-B-8 descoped + D4-C-4 blocked). Awaiting product decisions for live deployment.

**Quality Metrics (на коммите `df2177a`, 2026-07-16):** Build 22/22 ✅ | Lint 29/29 ✅ (0 errors) | Tests 778/778 ✅ (74 suites) | Migrations 001–043

**Current Focus:**
- Product decision: paper-first validation → mainnet minimal capital
- D4-C-4-LIVE-SMOKE (live testnet soak) — заблокирован по product decision
- Operator-run smoke на целевом paper-хосте (`docs/paper-deploy-dod.md`)

- **Phase 0–2** (foundation + controlled execution): **done** ✅
- **Phase 3** (paper trading engine): **done** ✅
- **Phase 4** (wide-universe scaling — all formal `P4-4-*` steps `done`): **done** ✅
- **Phase 5** (hermes-assisted operations — all formal `P5-5-*` steps `done`): **done** ✅
- **DEX-1 + DEX-2 + DEX-DOC** (46/46 steps): **done** ✅
- **Plan 3** (hermes Agent + MCP Server, 17/17): **done** ✅
- **Plan 4 / D4 deploy-readiness** (20/22: D4-A 8/8, D4-B 8/9 + B-8 descoped, D4-C 4/4 + C-4 blocked): **delivered** ✅ — operator auth (A-1), alertmanager paging (A-2), backup/restore (A-3), migrations collision fix (A-4), health probes (A-5), TLS (A-6), paper-smoke DoD (A-7); live-gate ADR + kill-switch (B-0, B-1), dex.limits + daily-volume DB (B-2), aggregate capital ceiling (B-3), wallet keys in DB (B-4), bridge finality (B-5), HMAC service-auth/mTLS (B-6), blocking secret-scan (B-7), two-person descoped (B-8), paper-live-boundary CI (B-9); structured pino logging (C-1), CHANGELOG + semver + git tag `v0.1.0-paper` (C-2), unified panic/emergency-stop CLI+UI (C-3), live-smoke DoD blocked (C-4)
- **Plan 5** (hermes Agent → GLM 5.2 + Telegram, 7/7): **done** ✅ — see [`docs/adr-hermes-agent-glm-telegram.md`](docs/adr-hermes-agent-glm-telegram.md)
- **Plan 6** (Hermes → управление настройками бота, 10/10): **done** ✅ — Hermes может по запросу в Telegram менять настройки config-service, **только безопасные ключи** (`intake/paper/opportunity/dex/features`), sensitive (`risk/execution/capital`) блокируются gateway 403. +8 MCP tools (22 всего), gateway `/hermes/v1/config/*`, скилл `config-management`. См. [`docs/adr-hermes-config-management.md`](docs/adr-hermes-config-management.md), [`.cursor/plans/DEVELOPMENT_PLAN6.md`](.cursor/plans/DEVELOPMENT_PLAN6.md)
- **Phase 2.2 short-term slice:** risk-service — token/route profile services, **`adaptiveRisk`** on `POST /evaluate-risk`, read APIs **`GET /policy/watchlist/tiers`**, **`GET /policy/route-scoring-history/:routeKey`**, **policy writer jobs** (`WatchlistTieringWriterService` / `RouteScoringWriterService`, optional `RISK_POLICY_JOBS_ENABLED`, **`POST /policy/jobs/watchlist-tiering`**, **`POST /policy/jobs/route-scoring`** with `x-arbibot-job-trigger` + `RISK_POLICY_JOB_TRIGGER_TOKEN`); docs **`docs/watchlist-tiering-logic.md`**, **`docs/route-scoring-logic.md`**; smoke **`npm run e2e:phase2-watchlist-route-scoring`**; CI — **`e2e-phase2-watchlist-route-scoring`** job, **`tools/ci-e2e-phase2-watchlist-route-scoring.sh`**, Grafana **`arbibot-risk-policy-writers.json`** with writer metrics; execution-orchestrator — **`playbook_config`** + `PartialFillPlaybookService`; paper-trading — promotion **`qualityTier`** / **`qualityScore`**, drift samples optional **`routeKey`**; **`tools/recalibration/`**; docs **`partial-fill-playbooks.md`**, **`recalibration-spec.md`**, **`paper-promotion-criteria.md`**; observability — histogram bucket reference in **`docs/observability-tracing.md`**; operator UI — **`/settings`** → «Watchlist tiers» + «Route scoring history», BFF **`GET /api/operator/settings/watchlist-tiers`**, **`GET /api/operator/settings/route-scoring/[routeKey]`**, offline export **`tools/export-route-scoring-history.mjs`**, **`npm run export:route-scoring-history`**
- **Last major update (2026-07-16, D4 deploy-readiness + Plan 5):** D4 deploy-readiness Phase A/B/C delivered (20/22 steps); hermes Agent wired to GLM 5.2 (Z.AI, OpenAI-compatible `base_url`) + personal Telegram bot (`HERMES_TELEGRAM_ENABLED`, `OPERATOR_TELEGRAM_ID`); skill `explain-bot`; npm scripts `build:hermes-mcp` / `doctor:hermes` / `run:hermes` / `dev:stack:hermes-agent`; docker profile `hermes-agent`. See [`docs/adr-hermes-agent-glm-telegram.md`](docs/adr-hermes-agent-glm-telegram.md), [`.cursor/plans/DEVELOPMENT_PLAN5.md`](.cursor/plans/DEVELOPMENT_PLAN5.md).
- **DEX fully complete (2026-05-21, session 38):** all 46/46 steps `done` (DEX-1 + DEX-2 + DEX-DOC); 3 bridge adapters (Across, Stargate, Native L2); `MultiLegPlanBuilder`; `CrossChainReconciliationService` + worker; multi-chain E2E (`tools/e2e-dex2-multichain.mjs`); bridge runbook (`docs/dex-runbook-bridge.md`); rollback strategy (`docs/dex-rollback-strategy.md`)
- **Bus-smoke verification (2026-04-19):** connection tests successful — Docker compose --profile bus running (Redpanda port 19092), `@arbibot/outbox-kafka-bridge` built, publisher/consumer connected to Kafka (consumer group: `arbibot-bus-smoke`), all artifacts from `docs/outbox-inbox.md` checklist verified
- **CFG-3 UI in `/settings`:** promote/activate draft completed (promote/activate draft workflows with React Query, draft checkboxes, Promote modal, `DestructiveOperatorAction` integration)
- **Paper discovery × config-service integration:** effective JSON on key `paper.discovery` with cache, env fallback, single-writer pattern respected
- **Review gate checklist:** [`docs/review-gate-cfg3-paper-discovery.md`](docs/review-gate-cfg3-paper-discovery.md) — backend/frontend/architecture checks passed
- **Phase 0–2** (foundation + controlled execution): completed
- **Phase 3** (paper trading): basic slice implemented (paper-trading-service, UI `/paper`, `/tokens`, `POST /opportunities/:id/paper-enqueue`)
- **Config service (CFG-1, CFG-2, CFG-3 slice):** implemented (NestJS + Fastify, Redis cache, audit, scopes / effective / history / rollback; **CFG-3 UI** completed — promote/activate draft in `/settings`; remaining CFG-3 backlog — [.cursor/plans/DEVELOPMENT_PLAN.md](.cursor/plans/DEVELOPMENT_PLAN.md))
- **Operator dashboards M2 (PRIO-P1-DASH):** completed (dashboard summary with incidents/capital widgets)
- **Paper quality improvements:** completed (Grafana dashboards, drift alerts v1/v2, SLO v1)
- **Paper Trading Complete (P3-1, P3-2, P3-3, P3-5, P3-6):** completed (paper trades mutations, promotion candidates mutations, virtual capital, drift gauges, E2E tests)
- **Paper Discovery Pipeline (P3-4):** implemented (discovery worker, candidate entity, E2E tests, **config-service integration**, bug fixes for entity ID handling)
- **Migrations:** 001–043 (в т.ч. **`024_fix_rollback_configuration_function.sql`**, **`025_execution_plan_playbook.sql`**, **`026_watchlist_tier_snapshots.sql`**, **`027_route_scoring_history.sql`**, **`028_paper_drift_route_key.sql`**, **`029_intake_policy_seed.sql`** — defaults `intake.throttling` / `intake.routing.tiers`; **`030_paper_promotion_quality_fields.sql`**, **`031_portfolio_position_close_idempotency.sql`**, **`032_dex_filters_seed.sql`** — DEX opportunity filters seed; **`033_dex_on_chain.sql`** — on-chain transactions, wallet states, DEX pools, approvals; **`034_on_chain_tx_leg_id_uuid.sql`** — OnChainTransaction.legId bigint→uuid; **`035_dex_live_limits_seed.sql`** — seed `dex.limits` + `dex.live` config; **`036_dex2_crosschain.sql`** — bridge transfers, cross-chain reconciliation tables; **`037_fix_get_effective_config_value.sql`** — fix rollback for effective config function; **`038_alertmanager_incidents.sql`** — alertmanager incident tracking (D4-A-2); **`039_dex_daily_volume.sql`** — DEX per-token daily volume (D4-B-2); **`040_portfolio_positions_notional_usd.sql`** — notional_usd on portfolio positions; **`041_capital_limits_seed.sql`** — seed `capital.limits` config (D4-B-3); **`042_wallet_keys.sql`** — wallet keys persistence in DB (D4-B-4); **`043_bridge_finality.sql`** — finality columns on `bridge_transfers` (D4-B-5)); policy scope **`020_policy_configuration_scopes.sql`** (исправленный rollback / совместимость)
- **DEVELOPMENT_PLAN:** Phase 4 **`P4-4-*`** steps **`done`** (as of **2026-04-20**), including **`P4-4-SCORE`** ([`docs/route-scoring-replay.md`](docs/route-scoring-replay.md), `npm run replay:route-scoring-export`) and **`P4-4-CH`** ([`docs/adr-phase4-clickhouse-gate.md`](docs/adr-phase4-clickhouse-gate.md), analytics path latency in [`docs/observability-tracing.md`](docs/observability-tracing.md)); **`PRIO-P2-PAPERDISC`**, **`PRIO-P2-TIER`**, **`PRIO-P2-SCORE`** → **`done`**; **`P5-5-GW`**, **`P5-5-OAPI`**, **`P5-5-OCUI`**, **`P5-5-BRIEF`** → **`done`**; **DEX-1** 35/35 → **`done`**; **DEX-2** 7/7 → **`done`** — see [.cursor/plans/DEVELOPMENT_PLAN.md](.cursor/plans/DEVELOPMENT_PLAN.md) and [.cursor/plans/DEVELOPMENT_PLAN-DEX.md](.cursor/plans/DEVELOPMENT_PLAN-DEX.md) for details

**Known issues:**
- ✅ **DEX стабилизация (коммит `48f3548`, 2026-05-17):**
  1. `pool-discovery.service.ts` — рефакторинг (66 изменений)
  2. `pool-discovery.service.spec.ts` — **94 новые строки тестов** (раньше тестов не было)
  3. `rpc-provider-manager.service.ts` — исправление утечки RPC worker (64 изменения)
  4. Все 3 pre-existing test issues ИСПРАВЛЕНЫ: plans.service.spec, wallet-manager.service.spec, rpc-provider-manager.service.spec
  - **Unit tests:** 285/285 passed (21 suites, execution-orchestrator)
  - **Build:** 21/21 ✅, **Lint:** 28/28 ✅ (0 errors)
- ✅ **DEX Integration — 3 блокера исправлены (2026-04-29):**
  1. `getEncryptedKey` реализован в WalletManager (делегирует к KeyVaultService)
  2. `ExecutionModule` создан, DI-регистрация `WalletManagerService` + `KeyVaultModule` + `WalletState`
  3. `KeyVaultService` переписан: aes-256-gcm, Buffer для crypto, hex для storage
  - **Unit tests:** 20/20 passed (`key-vault.service.spec.ts`)
  - **Build:** 21/21 пакетов green (включая новый `@arbibot/contracts-eth`)
- ✅ **DEX-1-0-TECH-CHOICE + DEX-1-0-ABIS → done (2026-04-29):**
  - `ethers.js v6.13.0` выбран как EVM library
  - Пакет `@arbibot/contracts-eth` создан (ABI UniV2/V3/Sushi + ERC20, адреса Arbitrum/Base/BNB, типы ChainId/Address)
  - DEX план v1.1, миграция DEX-1-0-MIGRATIONS перенумерована в `033`
- `FE-SETTINGS-POLICY-WORKSPACE` → `implemented`, awaiting `/review-step` → `done`
- CI зелёный на GitHub Actions не верифицирован (локально lint 28/28 ✅, build 21/21 ✅, tests 392/392 ✅)
- ~~Недостающие unit-тесты: `PoolDiscoveryService`~~ — ✅ **94 строки тестов добавлены** (коммит `48f3548`)
- ~~Недостающие unit-тесты: `RpcProviderManager`~~ — ✅ **22 теста** (покрытие: init/destroy, primary-only, error handling, health check, metrics, edge cases)
- Migration **020** rollback path repaired via **`024`**; применяйте миграции по порядку на чистых БД

### DEX Code Review & Filters (2026-04-28)

**DEX Opportunity Filters System (DEX-1-0-FILTERS):**
- Backend (`opportunity-service`): `DexFiltersConfigDto`, методы `applyDexFilters()`, `previewDexFilters()`, `getDexFiltersMetrics()`
- Frontend: `DexFiltersPanel`, BFF routes для preview/metrics
- Migration: `032_dex_filters_seed.sql`
- Documentation: [`docs/dex-filters-config-keys.md`](docs/dex-filters-config-keys.md)
- Типы фильтров: threshold (spread, profit, fees), volume, tokens, risk
- SLO: Filter application < 10ms, Preview < 100ms

**DEX Code Review — блокеры (все исправлены 2026-04-29):**
- ✅ Blocker 1: `getEncryptedKey` реализован (делегирует к KeyVaultService)
- ✅ Blocker 2: `ExecutionModule` создан с DI-регистрацией всех сервисов
- ✅ Blocker 3: `KeyVaultService` переписан (aes-256-gcm, Buffer для crypto)
- Task Management Policy: DEX задачи → `.cursor/plans/DEVELOPMENT_PLAN-DEX.md`, остальные → `docs/TODO.md`

**FE-SETTINGS-POLICY-WORKSPACE (`implemented`):**
- Вкладки `/settings`: Overview, All policies, Intake, Paper discovery, Extensions catalog, Diagnostics
- URL context для effective (`environment`, `tenantId`)
- Реестр policy-ключей + Zod валидация (`apps/web/lib/policy-config-registry.ts`)
- Docs: `docs/policy-config-keys-catalog.md`, `docs/opportunity-filters-config-keys.md`
- Awaiting: `/review-step` → `done`

### DEX-2 Cross-Chain (2026-05-21, session 37 — fully complete)

**Bridge Adapters (3 registered):**
- **Across** (`across-bridge.adapter.ts`) — Across Protocol for L2→L1 and L2→L2
- **Stargate** (`stargate-bridge.adapter.ts`) — Stargate LayerZero-based bridges
- **Native L2** (`native-bridge.adapter.ts`) — Official L2 bridges (Optimism, Arbitrum, Base)
- **Factory:** `BridgeAdapterFactoryService` — resolves adapter by bridge key
- **Transfer:** `BridgeTransferService` — initiates and tracks bridge transfers with timeout detection
- **Worker:** `BridgeTransferPollingWorker` — polls pending transfers for completion

**Multi-Leg Plans:**
- `MultiLegPlanBuilder` — builds DEX→bridge→DEX execution plans across chains
- 24 unit tests covering plan construction, leg ordering, and error cases

**Cross-Chain Reconciliation:**
- `CrossChainReconciliationService` — detects and reports cross-chain mismatches
- `CrossChainReconWorker` — periodic reconciliation cycles
- ~20 tests covering mismatch detection, resolution, and edge cases
- Migration: `036_dex2_crosschain.sql` (`bridge_transfers`, `cross_chain_reconciliation` tables)

**E2E:**
- `tools/e2e-dex2-multichain.mjs` — multi-chain workflow test
- ADR: `docs/adr-dex2-crosschain.md`

**Documentation complete:** `DEX-DOC-RUNBOOK-BRIDGE` ([`docs/dex-runbook-bridge.md`](docs/dex-runbook-bridge.md)), `DEX-DOC-ROLLBACK` ([`docs/dex-rollback-strategy.md`](docs/dex-rollback-strategy.md)) — all 46/46 DEX steps done ✅

### Last session details (2026-04-19)

**Bus-smoke verification:**
- Docker compose --profile bus запущен (Redpanda на порту 19092)
- `@arbibot/outbox-kafka-bridge` успешно собран
- Publisher verification: `npm run start:publish` запущен с переменными окружения (`KAFKA_BROKERS`, `DATABASE_URL`)
- Consumer verification: `npm run start:consume` запущен и подключился к Kafka:
  - Consumer group: `arbibot-bus-smoke`
  - Member ID: `arbibot-outbox-consumer-90b69e03-4491-4fe2-a91e-ea9a2eb71f5a`
  - Topic: `arbibot.domain.events` (partition 0)
- Проверенные артефакты (по чеклисту из `docs/outbox-inbox.md`):
  - Entrypoints: `dist/bin/publish.js`, `dist/bin/consume.js` — подтверждены
  - Фильтр event_type: `KAFKA_PUBLISH_EVENT_TYPES` — соответствует документации (`SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted`)
  - Smoke-consumer логирование: `eventName`, `entityType`, `correlationId` — подтверждены в коде
  - Env vars: `DATABASE_URL`, `KAFKA_BROKERS`, `KAFKA_TOPIC` — все обработаны

**Review gate PRIO-P2-PAPERDISC (closed):**
- Backend review: effective `paper.discovery`, кэш, env fallback, single-writer
- Frontend: `/settings` проверен
- Architecture: paper ↔ config read-only HTTP
- Observability: `installMetricsOnFastify` + `serviceName` во всех `apps/*/src/main.ts`
- Исправлен bug в `PaperDiscoveryService.runDiscoveryCycle` — обработка eligible-кандидатов по `id` сущностей из `create()`, а не по несуществующему `DiscoveryCandidate.id`
- Persistence: в `PaperDiscoveryCandidateEntity` добавлены колонки `token_key`/`route_key`; исправлен `@Index` на `created_at`; `paper-capital-reservation`: удалён недопустимый для TypeORM `check` в `@Column`
- Worker: Prometheus-метрики привязаны к `getArbibotMetricsRegistry()` через `registers: []`; удалены `ScheduleModule` и зависимость `@nestjs/schedule`; интервал через `setInterval` + `unref`/`clearInterval` в `onModuleDestroy`; метрика переименована в `arb_paper_discovery_processed_total`
- Тесты: моки `AuditClientService`/`PaperCapitalService` в `paper-trades`/`paper-promotion` specs; `paper-discovery.worker.spec` с `getArbibotMetricsRegistry().clear()` в `beforeEach`
- `DEVELOPMENT_PLAN.md`: `PRIO-P2-PAPERDISC` → `done` (с записью review)

**Monorepo ESLint (fixed):**
- Все 19 пакетов прошли ESLint check
- Исправлены ошибки в config-service и web:
  - `configurations.service.ts`: проверка `latest.is_active` без лишнего `Boolean()`
  - `promote-configuration.dto.ts`: удалён неиспользуемый импорт `IsNotEmpty`
  - `configurations.service.spec.ts`: `appendEntry` как отдельный `jest.fn()`
  - `paper-trades/[id]/route.ts`: удалён неиспользуемый импорт
  - `paper-promotion-table.tsx`, `paper-trades-table.tsx`: `handleAction` в `useCallback`, зависимости колонок в `useMemo`

**Open questions:**
- Full E2E bus-smoke с запущенными сервисами и сообщениями в топике отложен до необходимости
- Для полной проверки end-to-end с сообщениями в топике требуются сервисы с сгенерированными outbox_events (future)

**Phase 4 — implementation reference (2026-04-20–21):**
- **market-intake throttling:**
  - `PolicyCacheService` — policy cache via HTTP to config-service (`GET /policy/configurations/*/effective`) + risk `watchlist/tiers` + optional `route-scoring-history/:routeKey` (read-only, single-writer: risk-service)
  - `IntakeThrottleService` — throttling logic with env `INTAKE_THROTTLING_ENABLED`; returns **429** + explicit JSON `{ throttled: true }` on throttle (not silent drop); optional audit on `requireAuditOnThrottle` in `intake.throttling` JSON
  - `DegradationStateService` — tracks fallback mode, metrics `arb_intake_degradation_active`, `arb_intake_degradation_duration_seconds`
  - Metrics: `arb_intake_throttled_snapshots_total`, `arb_intake_samples_recorded_total`, `arb_intake_samples_dropped_total`, `arb_intake_tier_routing_total` (label: tier)
  - Health: `GET /health/degradation` — returns `{ degraded, fallbackMode, degradationReasons }`
  - Config JSON keys: `intake.throttling` (enabled, samplesPerSecond, requireAuditOnThrottle), `intake.routing.tiers` (priority list of instrumentKey arrays + sampling intervals)
  - README: `apps/market-intake-service/README.md`; tests: `policy-cache.service.spec.ts`
- **degraded UI signals:**
  - `apps/web`: BFF `GET /api/operator/health/degradation` (proxy to market-intake), `DegradedStatusBanner` component (polling 30s), dashboard intake section
  - Query keys: `operatorKeys.intakeDegradation`, `operatorKeys.dashboardSummary`
  - Styling: warning banner in operator layout with dismiss option
- **Phase 4 bridge / ADR docs:**
  - `docs/phase4-prep-bridge.md` — CI, observability, offline export plan
  - `docs/adr-phase4-intake-throttling.md` — ADR for throttling architecture
  - `docs/phase4-ui-degraded-signals.md` — degraded signals design
  - `docs/paper-promotion-quality-criteria.md` — promotion quality criteria
  - `docs/hermes-operator-api-spec.md` — hermes API specification
- **Grafana:**
  - `infra/grafana/dashboards/arbibot-risk-policy-writers.json` — intake panels added
  - `infra/grafana/README.md` — updated with intake metrics
- **P2 prep:**
  - `tools/recalibration/main.py` — stub Python CLI, JSON output only
  - `tools/recalibration/README.md` — recalibration spec
- **Phase 5 hermes (`P5-5-GW` done):**
  - `apps/hermes-gateway/` — Nest+Fastify, port 3020; **`HermesAuthGuard`** + **`GET /hermes/v1/plans`**, **`plans/:id`** (plan+legs), **`positions`**, **`incidents`**, **`dashboard/summary`**
  - `GET /health` — basic health; `GET /health/operator-bff` — BFF probe when `OPERATOR_WEB_BFF_BASE` set
  - `apps/web`: **`GET /api/operator/hermes/v1/*`** BFF → gateway (`HERMES_GATEWAY_URL`, `HERMES_BFF_API_KEY`); **`/hermes`** page shows read-only summary + sample plans when configured
  - `npm run dev:hermes` — dev command; Jest tests: `hermes-auth.guard.spec.ts`
  - Docs: [`apps/hermes-gateway/README.md`](apps/hermes-gateway/README.md), [`docs/hermes-gateway-runbook.md`](docs/hermes-gateway-runbook.md)
- **Env vars:**
  - `MARKET_INTAKE_API_BASE` — for web BFF
  - `INTAKE_THROTTLING_ENABLED` — feature flag
  - `INTAKE_POLICY_CACHE_MS` — policy cache TTL
  - `HERMES_GATEWAY_PORT` — hermes port (default 3020)
  - `HERMES_API_KEYS` — comma-separated keys for `x-hermes-api-key` on **`hermes-gateway`**
  - `HERMES_GATEWAY_URL` + `HERMES_BFF_API_KEY` — **`apps/web`** server-only BFF to gateway
  - `EXECUTION_API_BASE`, `PORTFOLIO_API_BASE`, `RECONCILIATION_API_BASE` — gateway upstream defaults
  - `OPERATOR_WEB_BFF_BASE` — for hermes gateway read-through + health probe

**Operational backlog (what / when):** [`docs/TODO.md`](docs/TODO.md) — живой список рядом с каноном [.cursor/plans/DEVELOPMENT_PLAN.md](.cursor/plans/DEVELOPMENT_PLAN.md).

**hermes:** сводка функций, запретов и Phase 5 — [`docs/hermes-reference.md`](docs/hermes-reference.md); границы API — [`docs/hermes-operator-boundaries.md`](docs/hermes-operator-boundaries.md).

### Hermes Agent + MCP Server (Plan 3)

> **Update (Plan 5, 2026-07-16):** агент переключён на **GLM 5.2** (Zhipu/Z.AI, через OpenAI-совместимый `base_url`, `provider: openai`) и **личный Telegram-бот** оператора (`HERMES_TELEGRAM_ENABLED=true`, whitelist `OPERATOR_TELEGRAM_ID`). Добавлен скилл `explain-bot` (объясняет работу бота по-русски), npm-скрипты `build:hermes-mcp` / `doctor:hermes` / `run:hermes` / `dev:stack:hermes-agent`, docker-профиль `hermes-agent`. MCP Server и Gateway без изменений. См. [`docs/adr-hermes-agent-glm-telegram.md`](docs/adr-hermes-agent-glm-telegram.md) и [`.cursor/plans/DEVELOPMENT_PLAN5.md`](.cursor/plans/DEVELOPMENT_PLAN5.md).

> ✅ **Plan 5 runtime — пройден (2026-07-22, Aéza Frankfurt).** Изначально Plan 5 был помечен
> 7/7 done без запуска бинарника end-to-end (баг `hermes run` в `tools/run-hermes-agent.mjs`
> — см. [`docs/lessons/hermes-agent-dod-failure.md`](docs/lessons/hermes-agent-dod-failure.md)).
> При paper-deploy на Aéza сняты 3 блокера последовательно: (1) команда `hermes run` →
> `hermes gateway run`; (2) Telegram adapter — секция `platforms` в `~/.hermes/config.yaml`;
> (3) GLM endpoint — `open.bigmodel.cn` (timeout из EU) → `api.z.ai/api/coding/paas/v4`
> (международный coding endpoint для Coding Plan). Agent обновлён до **v0.19.0 (Quicksilver)**.
> Все 6 runtime критериев H5-G-RUNTIME — **PASS**. Pipeline полностью работает:
> Operator → Telegram → Agent → GLM 5.2 → MCP → Gateway → ответ. Требуется активная
> GLM Coding Plan подписка на https://z.ai. CI smoke: `npm run ci:hermes-agent-smoke`.

- **MCP Server:** `packages/hermes-mcp-server/` (`@arbibot/hermes-mcp-server`) — TypeScript MCP server exposing 14 tools via stdio transport → Hermes Gateway HTTP API
- **Agent config:** `tools/hermes-agent/` — Hermes Agent (NousResearch) YAML config + MCP connection config
  - `hermes-config.yaml` — LLM provider, messaging (Telegram/Discord), cron, skills path
  - `mcp-config.json` — MCP server stdio connection (command, args, env)
- **Skills:** `tools/hermes-agent/skills/` — 6 Arbibot-specific skills (markdown):
  - `investigate-incident` — автоанализ инцидента → рекомендация
  - `risk-summary` — сводка risk decisions за период
  - `reconciliation-check` — mismatches → отчёт → рекомендации
  - `force-hedge-preview` — NL impact preview перед force hedge
  - `daily-report` — ежедневный отчёт (cron)
  - `safe-mode-check` — проверка + рекомендация safe-mode
- **MCP Tools (14):** list_plans, get_plan, arm_plan, execute_plan, list_positions, close_position, list_incidents, resolve_incident, list_incident_briefs, get_safe_mode_status, enable_safe_mode, disable_safe_mode, get_approvals_queue, get_dashboard_summary
- **ADR:** [`docs/adr-hermes-agent-integration.md`](docs/adr-hermes-agent-integration.md)
- **Env vars:** `HERMES_MCP_PORT` (default 4000), `HERMES_AGENT_API_KEY`
- **D4 deploy-readiness env vars (added 2026-07-12→16):**
  - **Operator auth (D4-A-1):** `OPERATOR_SESSION_SECRET` (required in prod, JWT signing), `OPERATOR_BOOTSTRAP_TOKEN`, `OPERATOR_SESSION_TTL_SECONDS` (default 28800)
  - **Service auth / mTLS (D4-B-6):** `ARBIBOT_SERVICE_AUTH_ENABLED` (default `true` in prod), `ARBIBOT_SERVICE_AUTH_SECRET` (shared HMAC for inbound guard + outbound `signedFetch`), `HERMES_SIGN_UPSTREAM` (`true` in live → sign hermes-gateway upstream calls)
  - **Logging (D4-C-1):** `LOG_LEVEL` (pino, default `info`), `ARBIBOT_LOG_PRETTY` (set `true` for dev pretty-print)
  - **Kill-switch (D4-B-1):** `DEX_LIVE_KILL_SWITCH` (env override of `dex.limits.killSwitch`), `DEX_KILL_SWITCH_CACHE_TTL_MS`, `DEX_KILL_SWITCH_HTTP_TIMEOUT_MS`
  - **Capital ceiling (D4-B-3):** `CAPITAL_MAX_ACTIVE_USD` (aggregate ceiling across reservations + open positions)
  - **Bridge (D4-B-5):** `BRIDGE_FINALITY_CONFIRMATIONS`, `BRIDGE_POLLING_ENABLED`, `BRIDGE_POLLING_INTERVAL_MS`, `CROSS_CHAIN_RECON_*`
  - **Panic-stop (D4-C-3):** handled via `panic:stop`/`panic:recover` scripts + `DEX_LIVE_KILL_SWITCH` flip
- **Hermes Agent GLM/Telegram env vars (Plan 5, 2026-07-16):**
  - `HERMES_LLM_PROVIDER` (default `openai`), `HERMES_LLM_MODEL` (default `glm-5.2`), `HERMES_LLM_BASE_URL` (Z.AI OpenAI-compatible endpoint), `HERMES_LLM_API_KEY`
  - `HERMES_TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`, `OPERATOR_TELEGRAM_ID` (whitelist)
  - `HERMES_MCP_SERVER_PATH`, `HERMES_CRON_ENABLED`, `HERMES_MEMORY_PATH`, `HERMES_LOG_LEVEL`
  - See [`docs/adr-hermes-agent-glm-telegram.md`](docs/adr-hermes-agent-glm-telegram.md), [`.env.example`](.env.example) hermes-agent section
- **Plan:** [`.cursor/plans/DEVELOPMENT_PLAN3.md`](.cursor/plans/DEVELOPMENT_PLAN3.md) — 17 steps (A: rename, B: MCP server, C: agent integration)

**Первичный запуск (paper → live):** по замыслу владельцев продукта **paper trading** на стадии первого вывода в эксплуатацию — **обязательный** сквозной тест всего стека (данные → возможности → риск → капитал → виртуальное исполнение → observability/UI) и накопление статистики **без** реальных потерь; после приёмки включается **live с минимальным капиталом**. Это зафиксировано в `DEVELOPMENT_PLAN.md` (раздел «Операционная последовательность первичного запуска»), в архитектурном и фронтенд-спек-документах в корне репозитория.

### Infrastructure

PostgreSQL 16 and Redis 7 for local dev:

```bash
docker compose -f infra/docker-compose.dev.yml up -d
```

Optional Kafka-compatible bus (Redpanda): add `--profile bus`.

```bash
docker compose -f infra/docker-compose.dev.yml --profile bus up -d
```

**Postgres host port (dev compose):** `infra/docker-compose.dev.yml` maps Postgres to host port **15432** (`15432:5432`) so a separate PostgreSQL on **localhost:5432** does not intercept `DATABASE_URL`. Match [`.env.example`](.env.example) (`127.0.0.1:15432`). CI (GitHub Actions) still uses the service container on **5432** inside the job.

**Windows and Nest apps:** (1) **`nest start` / watch:** keep **`@nestjs/cli` 11.0.21+** and prefer **local** `npm` scripts, not a global `nest` binary ([`nestjs/nest-cli#2358`](https://github.com/nestjs/nest-cli/issues/2358)). (2) **No `dist/main.js` after a “successful” build:** check `cwd` (artefacts are under `apps/<service>/dist/`), run **`npm run build -w @arbibot/<name>`** from the repo root, and compare with a direct `npx tsc -p apps/<service>/tsconfig.build.json` if in doubt. **In this monorepo**, Nest app **`build`** / **`start`** / **`start:dev`** use **`tsc -p tsconfig.build.json`**, **`node dist/main.js`**, and a **`concurrently` + `tsc --watch` + `node --watch`** dev loop so the CLI does not need to wrap `node` for normal local runs; **`nest-cli.json`** uses **“builder”: “tsc”** (and you can still run **`npx nest build`** in a package if you need the CLI).
Use [`.env.example`](.env.example) as the source of truth for local env vars (`DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `KAFKA_BROKERS`, `ARBIBOT_DEV_ROLE`, optional **`ARBIBOT_DEV_OPERATOR_ID`** for config-service audit in BFF). For **`apps/web`** server-side BFF proxies, use **`*_API_BASE`** (see [`apps/web/lib/api-base.ts`](apps/web/lib/api-base.ts)), including **`CONFIG_API_BASE`**, **`PORTFOLIO_API_BASE`**, **`RECONCILIATION_API_BASE`**, **`PAPER_API_BASE`**, and **`MARKET_INTAKE_API_BASE`**.

### Root workspace

From the repo root:

- `npm ci` — install all workspaces
- `npm run lint` — Turbo lint (Nest apps, packages, `apps/web`)
- `npm run build` — Turbo build
- `npm run test` — Turbo test
- `npm run db:migrate` — apply SQL migrations under `infra/postgres/migrations/` (001–043)
- `npm run e2e:phase1-foundation` — HTTP smoke for Phase 1 DoD §50.3 (snapshot → opportunity → risk → reserve → arm); optional `E2E_INCLUDE_EXECUTION_LEG=true` extends through `apply-fill`; requires migrated DB and running `market-intake`, `opportunity`, `risk`, `capital`, `execution-orchestrator` (see `tools/e2e-phase1-foundation-chain.mjs` for ports / env overrides)
- `npm run e2e:phase2-controlled-execution` — extends the Phase 1 chain through **all** execution legs until the plan is `completed` (see `tools/e2e-phase2-controlled-execution.mjs`); use `EXECUTION_BEGIN_LEG_COUNT` on **execution-orchestrator** for multi-leg; optional settlement envs as in `docs/settlement-post-commit.md`
- `npm run e2e:phase2-watchlist-route-scoring` — seeds `token_profiles` / `route_profiles` / `risk_decisions` via `DATABASE_URL`, triggers **`POST /policy/jobs/*`** on **risk-service** (`RISK_SERVICE_URL`, `RISK_POLICY_JOB_TRIGGER_TOKEN`); see `tools/e2e-phase2-watchlist-route-scoring.mjs`
- `npm run e2e:phase3-paper-promotion` — smoke: create opportunity → `paper-enqueue` (dedup) → poll paper **`/paper/promotion-candidates`** until relay delivers (see `tools/e2e-phase3-paper-promotion.mjs`); requires migrated DB (**`018`**), **paper-trading-service**, **opportunity-service** with **`PAPER_TRADING_SERVICE_URL`** set to paper base URL; script waits for **`GET /metrics`** on both services first
- `npm run ci:e2e-phase3` — CI wrapper: Postgres + **paper-trading-service** + **opportunity-service** with fast **`OUTBOX_RELAY_POLL_MS`**, then `e2e:phase3-paper-promotion` (see `tools/ci-e2e-phase3-paper-promotion.sh`); GitHub Actions job **`e2e-phase3-paper-promotion`**
- `npm run ci:e2e-phase3-paper-discovery` — CI: Postgres + **paper-trading-service** + **market-intake-service** + `node tools/e2e-p3-paper-discovery.mjs` (`tools/ci-e2e-phase3-paper-discovery.sh`); GitHub Actions job **`e2e-phase3-paper-discovery`**
- `npm run ci:e2e-phase2` — same Phase 2 HTTP chain with **Postgres + lab HTTP venue + built Nest apps** (see `tools/ci-e2e-phase2.sh`); GitHub Actions runs this as job **`e2e-phase2`** after `npm run build`
- `npm run ci:e2e-phase2-watchlist-route-scoring` — Postgres + **risk-service** + `e2e:phase2-watchlist-route-scoring` (see `tools/ci-e2e-phase2-watchlist-route-scoring.sh`); GitHub Actions job **`e2e-phase2-watchlist-route-scoring`**
- `npm run e2e:phase4-tier-routing` — Phase 4 intake tier routing + warm sampling throttle (requires `INTAKE_THROTTLING_ENABLED=true`, running **risk-service**, **config-service**, **market-intake**); see `tools/e2e-phase4-tier-routing.mjs`
- `npm run ci:e2e-phase4-tier-routing` — Postgres + risk + config + market-intake + `e2e:phase4-tier-routing` (`tools/ci-e2e-phase4-tier-routing.sh`); GitHub Actions job **`e2e-phase4-tier-routing`**
- `npm run seed:intake-policy-config` — HTTP upsert `intake.*` keys via config-service (`tools/seed-intake-policy-config.mjs`; config may need `AUDIT_CLIENT_ENABLED=false` if audit is down)
- `npm run ci:bus-smoke` — build `@arbibot/outbox-kafka-bridge` + optional Docker `--profile bus` (`tools/ci-bus-smoke.sh`); GitHub Actions job **`bus-smoke`**; optional `SEED_OUTBOX=1` with `DATABASE_URL` runs [`tools/seed-outbox-events.mjs`](tools/seed-outbox-events.mjs)
- `npm run ci:key-leakage` — static grep guard for wallet key/mnemonic leakage patterns (K1/K2 from `dex-security-and-capital-safety` SKILL): logging a decrypted key, `decryptPrivateKey` outside `KeyVaultService`/`wallet-manager`, raw 64-hex key or BIP-39 mnemonic in production code (`tools/ci-key-leakage.sh`); GitHub Actions job **`secret-scan`** (**blocking** since D4-B-7-SECRET-SCAN, complements `.github/gitleaks-config.toml` value guard); excludes `*.spec.ts`/`*.d.ts`/`dist/`/mocks
- `npm run seed:outbox-smoke-events` — insert one `SnapshotUpdated` row into `outbox_events` for manual bus publish tests
- `npm run seed:outbox-smoke-events:all` — insert one row per Kafka bridge `event_type` (`SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, `PlanCompleted`) for full bus smoke
- `npm run db:verify-migrations` — verify `schema_migrations` contains **030** and **031** (override list: `node tools/verify-migrations-applied.mjs <file.sql> ...`)
- `npm run db:verify-migrations:all` — verify **all** `infra/postgres/migrations/*.sql` rows exist (same as `node tools/verify-migrations-applied.mjs --all`)
- `npm run venue:load-test` — concurrent HTTP venue submits (`VENUE_HTTP_BASE_URL`, optional `VENUE_LOAD_CONCURRENCY`, `VENUE_LOAD_REQUESTS`)
- `npm run export:route-scoring-history` — JSONL/CSV export from `route_scoring_history` for offline replay prep (`DATABASE_URL`, optional `ROUTE_KEY`, `LOOKBACK_HOURS`, `FORMAT`)
- `npm run replay:route-scoring-export` — summarize or compare JSONL exports (`summary [file]` reads stdin if omitted; `compare <before> <after>`); see [`docs/route-scoring-replay.md`](docs/route-scoring-replay.md)
- `npm run bus:publish` — build and publish outbox rows to Kafka/Redpanda for `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, and `PlanCompleted` (see `@arbibot/outbox-kafka-bridge`); checklist in [`docs/outbox-inbox.md`](docs/outbox-inbox.md) (profile `bus`, `DATABASE_URL`, `KAFKA_BROKERS`).
- `npm run bus:consume` — build and run smoke consumer with inbox claim (logs `eventName` and `entityType` on successful claim)
- **D4 deploy-readiness scripts:**
  - `npm run db:backup` — backup Postgres (`tools/backup-postgres.sh`)
  - `npm run db:restore` — restore from dump (`tools/backup-postgres.sh restore`, D4-A-3)
  - `npm run verify:env` — validate `.env` for prod/paper deploy (`tools/validate-env.sh`, D4-A-1/A-6/B-6); fails on missing `OPERATOR_SESSION_SECRET`, auth config, TLS, etc.
  - `npm run verify:deployment` — composite pre-deploy verification (`tools/verify-deployment.sh`)
  - `npm run generate:tls` — generate self-signed TLS certs for paper-deploy (`tools/generate-tls-certs.sh`, D4-A-6)
  - `npm run panic:stop` — **unified emergency-stop** (D4-C-3): `tools/panic-button.sh` → flips `DEX_LIVE_KILL_SWITCH=true` via config-service + UI banner
  - `npm run panic:recover` — clear panic state (`tools/panic-recover.sh`, D4-C-3)
  - `npm run ci:paper-live-boundary` — CI guard for paper/live import-graph isolation (D4-B-9, `tools/ci-paper-live-boundary.sh`); GitHub Actions job **`paper-live-boundary`**
- **Hermes Agent wiring smoke:** `npm run ci:hermes-agent-smoke` — regression guard for hermes-agent wiring (`tools/ci-hermes-agent-smoke.sh`): verifies `run-hermes-agent.mjs` invokes `gateway run` (not the non-existent `run`), doctor stays read-only, MCP builds + starts via stdio, config targets GLM 5.2 + Telegram; GitHub Actions job **`hermes-agent-smoke`**. Catches the class of bug that let Plan 5 ship "7/7 done" without the binary ever running — see [`docs/lessons/hermes-agent-dod-failure.md`](docs/lessons/hermes-agent-dod-failure.md). Does NOT test real Telegram/GLM round-trip (needs secrets) — that is the manual runtime DoD `H5-G-RUNTIME`.
- **DEX / Hermes Agent operational scripts:**
  - `npm run dex:load-test` — concurrent DEX venue load test (`tools/dex-load-test.mjs`)
  - `npm run e2e:dex2-multichain` — multi-chain bridge E2E (`tools/e2e-dex2-multichain.mjs`)
  - `npm run e2e:dex-testnet` — DEX testnet E2E (`tools/e2e-dex1-testnet.mjs`)
  - `npm run drill:1` — paper-incident operational drill (`tools/drill-1-paper-incident.mjs`)
  - `npm run db:seed-canonical` — seed canonical registry tables (`tools/seed-canonical-registry.mjs`)
  - `npm run build:hermes-mcp` — build `@arbibot/hermes-mcp-server` (Plan 5)
  - `npm run doctor:hermes` — hermes-agent config/env diagnostics (`tools/doctor-hermes-agent.mjs`, Plan 5)
  - `npm run run:hermes` — run hermes-agent locally (`tools/run-hermes-agent.mjs`, Plan 5)
  - `npm run dev:stack` — Docker compose dev stack (`infra/docker-compose.dev.yml`); `npm run dev:stack:hermes-agent` adds the `hermes-agent` profile

Copy [`.env.example`](.env.example) to `.env` and adjust URLs. Typical Nest env: `PORT`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `KAFKA_BROKERS`, and service-to-service URLs where applicable (e.g. **`RISK_SERVICE_URL`** for `opportunity-service` → risk; **`REDIS_URL`** also for **config-service** cache; optional **`PAPER_TRADING_SERVICE_URL`** for `opportunity-service` → paper promotion enqueue). **`apps/web`** uses **`RISK_API_BASE`**, **`OPPORTUNITY_API_BASE`**, **`CAPITAL_API_BASE`**, **`EXECUTION_API_BASE`**, **`AUDIT_API_BASE`**, **`CONFIG_API_BASE`**, **`PORTFOLIO_API_BASE`**, **`RECONCILIATION_API_BASE`**, **`PAPER_API_BASE`**, **`MARKET_INTAKE_API_BASE`** for upstream HTTP (same defaults as local ports; override per deploy).

### Backend services (`apps/*`)

| App | Default PORT (env `PORT`) |
|-----|---------------------------|
| risk-service | 3000 |
| opportunity-service | 3010 |
| capital-service | 3011 |
| execution-orchestrator | 3012 |
| audit-service | 3013 |
| canonical-market-service | 3014 |
| market-intake-service | 3015 |
| hermes-gateway | 3020 (`HERMES_GATEWAY_PORT`) |
| portfolio-service | 3016 |
| reconciliation-service | 3017 |
| paper-trading-service | 3018 |
| config-service | 3019 |

Each service: `npm run start:dev -w @arbibot/<name>` or use root scripts in [`package.json`](package.json): `dev:risk`, `dev:opportunity`, `dev:capital`, `dev:execution`, `dev:audit`, `dev:canonical`, `dev:intake`, `dev:portfolio`, `dev:reconciliation`, `dev:paper`, **`dev:config`**, **`dev:hermes`**, `dev:web`.

Shared libraries live under [`packages/`](packages/), especially:

- `@arbibot/contracts`
- `@arbibot/contracts-eth` — EVM ABI, addresses, chain types (DEX)
- `@arbibot/persistence`
- `@arbibot/messaging`
- `@arbibot/nest-database`
- `@arbibot/nest-platform`
- `@arbibot/outbox-kafka-bridge`
- `@arbibot/hermes-mcp-server` — MCP Server для Hermes Agent (14 tools → gateway)

### Frontend (`apps/web`)

- Stack conventions (React Query BFF, shadcn-style UI, RSC vs client): [`apps/web/STACK-CONVENTIONS.md`](apps/web/STACK-CONVENTIONS.md).
- Dev: `npm run dev -w @arbibot/web` (Next.js defaults to port **3000**; use another port if a Nest app uses 3000, e.g. `PORT=3001 npm run dev -w @arbibot/web`).
- Lint / build: `npm run lint -w @arbibot/web`, `npm run build -w @arbibot/web`.
- Server-side BFF fetches use **`*_API_BASE`** env vars (`RISK_API_BASE`, `OPPORTUNITY_API_BASE`, `CAPITAL_API_BASE`, `EXECUTION_API_BASE`, `AUDIT_API_BASE`, **`CONFIG_API_BASE`**, `PORTFOLIO_API_BASE`, `RECONCILIATION_API_BASE`, `PAPER_API_BASE`, **`MARKET_INTAKE_API_BASE`**); see [`apps/web/lib/api-base.ts`](apps/web/lib/api-base.ts) and [`.env.example`](.env.example).

#### BFF Routes
- **Dashboard:** `/api/operator/dashboard/summary` (incidents open/resolved today, capital positions count, total notional USD, intake degradation status — Phase 4)
- **Paper trades mutations:** `/api/operator/paper/trades/[id]?action=approve|reject|cancel`
- **Paper promotion candidates mutations:** `/api/operator/paper/promotion-candidates/[id]?action=approve|reject`
- **Settings (config-service):**
  - `/api/operator/settings/configurations` (list, create)
  - `/api/operator/settings/configurations/[configKey]` (get, update)
  - `/api/operator/settings/configurations/[configKey]/effective` (**GET** — resolved value with scope fallback; query `environment`, `tenantId`)
  - `/api/operator/settings/configurations/[configKey]/history` (version history)
  - `/api/operator/settings/configurations/[configKey]/rollback` (rollback to prior version)
  - `/api/operator/settings/configurations/[configKey]/promote` (CFG-3: scope promotion)
  - `/api/operator/settings/configurations/[configKey]/status` (CFG-3: activate draft — `PATCH`)
  - `/api/operator/settings/watchlist-tiers` (read-only: **GET** → risk `GET /policy/watchlist/tiers`)
  - `/api/operator/settings/route-scoring/[routeKey]` (read-only: **GET** → risk `GET /policy/route-scoring-history/:routeKey`)
- **Health (Phase 4 intake):**
  - `/api/operator/health/degradation` (read-only: **GET** → market-intake `GET /health/degradation` — returns `{ degraded, fallbackMode, degradationReasons }`)
- **Health (DEX):**
  - `/api/operator/health/dex` (read-only: **GET** → execution-orchestrator `GET /health/dex` — composite DEX health: RPC, wallet, gas, pool discovery)
- **hermes (Phase 5 read-through + mutations):**
  - `/api/operator/hermes/v1/[[...path]]` (**GET** / **POST** / **PATCH** → `HERMES_GATEWAY_URL/hermes/v1/...` with server `HERMES_BFF_API_KEY`; proxies reads + mutations; **POST/PATCH** require operator session and inject `operatorId`)

- UI routes: `/dashboard`, `/portfolio`, `/opportunities`, `/execution`, `/tokens`, `/paper`, `/incidents`, `/runbooks`, `/hermes`, **`/settings`** (policy configurations via config-service BFF). Phase 3 slice: `/paper` and `/tokens` include paper trades, promotion candidates, drift samples, discovery candidates with proper mutation flows and operator safety.

Operator session in dev: see `apps/web` middleware / `getOperatorSession` — `ARBIBOT_DEV_ROLE` or `arbibot_role` cookie.

### Current Phase 1 notes (2026-04-19)

- **`opportunity-service` in-DB outbox relay** (`OutboxRelayService`): forwards **`RiskDecisionIssued`** and **`PaperPromotionCandidateRequested`** to **paper-trading-service** over HTTP when `PAPER_TRADING_SERVICE_URL` is set (enqueue is **outbox-first** — no synchronous "fire POST from the handler" path for promotion). Relay and bridge each use their own **event-type allowlists**; do not assume Kafka covers relay-only types.
- **`@arbibot/outbox-kafka-bridge`** publishes `SnapshotUpdated`, `CapitalReserved`, `PlanArmed`, `LegFilled`, and `PlanCompleted` to Kafka/Redpanda (filtered `event_type` list). It is a **separate** publisher from the opportunity in-DB relay; keep filters documented and avoid double-publishing the same logical delivery. See [`docs/outbox-inbox.md`](docs/outbox-inbox.md).
- SQL migrations are applied lexicographically by `tools/db-migrate.mjs`; current migrations **001–043** include: canonical market, market intake idempotency, outbox relay dead-letter fields, execution/portfolio/reconciliation, fill/idempotency, **token/route profiles and risk decision keys** (`015_token_route_profiles.sql`), **paper trading** (`016_paper_trading.sql`, `017_paper_promotion_enqueue_idempotency.sql`), **outbox dedup for `paper-enqueue`** (`018_outbox_paper_enqueue_dedup.sql`), **policy configurations** (`019_policy_configurations.sql`), **policy configuration scopes** (`020_policy_configuration_scopes.sql`, CFG-3), **paper capital reservations** (`021_paper_capital_reservations.sql`), **paper discovery candidates** (`022_paper_discovery_candidates.sql`, `023_paper_discovery_candidates_fixes.sql`), later **`024`–`028`** (execution playbooks, watchlist/scoring history, paper drift `route_key`), **`029_intake_policy_seed.sql`** (defaults for `intake.throttling` / `intake.routing.tiers`), **`030_paper_promotion_quality_fields.sql`**, **`031_portfolio_position_close_idempotency.sql`**, **`032_dex_filters_seed.sql`** (DEX opportunity filters seed), **`033_dex_on_chain.sql`** (`on_chain_transactions`, `wallet_states`, `dex_pools`, `approvals` + indexes + triggers), **`034_on_chain_tx_leg_id_uuid.sql`** (OnChainTransaction.legId bigint→uuid), **`035_dex_live_limits_seed.sql`** (seed `dex.limits` + `dex.live` config), **`036_dex2_crosschain.sql`** (`bridge_transfers`, `cross_chain_reconciliation` tables), **`037_fix_get_effective_config_value.sql`** (effective config rollback fix), **`038_alertmanager_incidents.sql`** (D4-A-2 paging), **`039_dex_daily_volume.sql`** (D4-B-2 daily-volume), **`040_portfolio_positions_notional_usd.sql`** (notional_usd), **`041_capital_limits_seed.sql`** (D4-B-3 capital ceiling seed), **`042_wallet_keys.sql`** (D4-B-4 wallet keys persistence), **`043_bridge_finality.sql`** (D4-B-5 finality columns).
- Canonical registry tables are not auto-seeded; after migrations, `venue_refs`, `canonical_instruments`, and `canonical_routes` must be populated manually before `resolve-*` endpoints return data.

### Phase 2 slice (controlled execution / policy)

- **HTTP venue:** `VENUE_HTTP_BASE_URL` + optional `VENUE_HTTP_TIMEOUT_MS`; lab stand [`tools/lab-venue-stand.mjs`](tools/lab-venue-stand.mjs) (`LAB_VENUE_PORT`); CI Phase 2 chain: `npm run ci:e2e-phase2` / job **`e2e-phase2`**.
- **Risk profiles:** `GET /policy/phase2-readiness`, `GET /policy/token-profiles`, `GET /policy/route-profiles`; `POST /evaluate-risk` optional `instrumentKey` / `routeKey` (DB caps). Roadmap: [`docs/phase2-risk-policy-roadmap.md`](docs/phase2-risk-policy-roadmap.md).
- **Reconciliation P0 procedure** (operator checklist): [`docs/reconciliation-p0-procedures.md`](docs/reconciliation-p0-procedures.md).
- **Metrics:** shared registry via `getArbibotMetricsRegistry()` from `@arbibot/nest-platform` (same registry as `GET /metrics`); orchestrator exposes `arb_execution_leg_partial_fill_commits_total` on partial fills.
- **Observability v1:** SLO v1 and on-call in [`docs/observability-tracing.md`](docs/observability-tracing.md) — production-ready baseline with 3 tiers (Tier 1: 500ms p99, 99.9% monthly).

### Phase 3 slice (paper) — complete implementation (2026-04-18)

- **`@arbibot/paper-trading-service`** (default port **3018**): single-writer HTTP API for paper trades, promotion candidates, drift samples, and discovery candidates; persistence in Postgres via migrations **`016_paper_trading.sql`**, **`017_paper_promotion_enqueue_idempotency.sql`**, **`018_outbox_paper_enqueue_dedup.sql`**, **`021_paper_capital_reservations.sql`**, **`022_paper_discovery_candidates.sql`**, **`023_paper_discovery_candidates_fixes.sql`** (apply with `npm run db:migrate`).
- **Opportunity → paper:** `POST /opportunities/:id/paper-enqueue` writes **`PaperPromotionCandidateRequested`** to **`outbox_events`**; pending-row dedup for enqueue is enforced by **`018_outbox_paper_enqueue_dedup.sql`** on the same OLTP DB as the outbox. The opportunity relay delivers to paper (idempotent **`enqueueIdempotencyKey`** on the paper side). Env: **`PAPER_TRADING_SERVICE_URL`** (service-to-service), **`PAPER_API_BASE`** / BFF for operator reads.

#### P3-1, P3-2: Paper Trades & Promotion Candidates Mutations
- **Backend:** `POST /paper/trades/:id/approve|reject|cancel`, `POST /paper/promotion-candidates/:id/approve|reject`
- **Service:** `PaperTradesService`, `PaperPromotionService` with audit integration
- **BFF:** `/api/operator/paper/trades/[id]?action=approve|reject|cancel`, `/api/operator/paper/promotion-candidates/[id]?action=approve|reject`
- **Frontend:** approval buttons in `PaperTradesTable`, `PaperPromotionTable`

#### P3-3: Virtual Capital (Paper-Only)
- **Migration:** `021_paper_capital_reservations.sql` — table with state machine (active → expired)
- **Entity:** `PaperCapitalReservationEntity` in @arbibot/persistence
- **Service:** `PaperCapitalService` with reserveCapital/expireReservations/getActiveReservation
- **Integration:** PaperTradesService.approve creates reservation, PaperTradesService.cancel expires reservations
- **TTL:** 60 minutes default, background job for expiry
- **Isolation:** complete separation from live capital-service

#### P3-4: Paper Discovery Pipeline
- **Service:** `PaperDiscoveryService` — worker for automatic paper-only opportunities
- **Controller:** `PaperDiscoveryController` — endpoints for triggering discovery, listing candidates
- **Worker:** `PaperDiscoveryWorker` — periodic discovery cycles (configurable via env vars)
- **Entity:** `PaperDiscoveryCandidateEntity` in @arbibot/persistence
- **Migrations:** `022_paper_discovery_candidates.sql`, `023_paper_discovery_candidates_fixes.sql`
- **State machine:** discovered → processed | rejected (enqueued removed per paper isolation)
- **E2E:** `tools/e2e-p3-paper-discovery.mjs` — complete discovery workflow test
- **Policy (config-service):** effective JSON on key **`paper.discovery`** (`GET /policy/configurations/paper.discovery/effective`); cache `PAPER_DISCOVERY_CONFIG_CACHE_MS`; fallback env lists — [`docs/paper-discovery-config-keys.md`](docs/paper-discovery-config-keys.md)
- **Tests:** `paper-discovery.service.spec.ts` — expanded with mock fetch and env-specific module build
- **Review gate:** checklist for CFG-3 UI and paper discovery integration — [`docs/review-gate-cfg3-paper-discovery.md`](docs/review-gate-cfg3-paper-discovery.md)
- **Status:** `PRIO-P2-PAPERDISC` → **`done`** (see [`docs/review-gate-cfg3-paper-discovery.md`](docs/review-gate-cfg3-paper-discovery.md))
- **Env vars:** `CONFIG_SERVICE_URL` or `CONFIG_API_BASE`, `PAPER_DISCOVERY_CONFIG_CACHE_MS`, `PAPER_DISCOVERY_CONFIG_ENVIRONMENT`, `PAPER_DISCOVERY_CONFIG_TENANT_ID`, plus `PAPER_DISCOVERY_ENABLED`, `PAPER_DISCOVERY_INTERVAL_MS`, `PAPER_DISCOVERY_MIN_PROFIT_USD`, `PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE`, `PAPER_DISCOVERY_MAX_CANDIDATES_PER_RUN`, `PAPER_DISCOVERY_PAPER_ONLY_TOKENS`, `PAPER_DISCOVERY_PAPER_ONLY_ROUTES`

#### P3-5: Drift Gauges & Recording Rules
- **Service:** `updateStaleGauges()` method in `PaperDriftService`
- **Gauges:** `paperDriftBpsCurrent` (current drift), `paperDriftBpsStale` (stale instruments count)
- **Recording rules:** `infra/grafana/recording-rules/paper-drift-recording.yml`
  - `arb_paper_drift_bps_avg_5m` — average drift over 5m
  - `arb_paper_drift_bps_max_15m` — maximum drift over 15m
  - `arb_paper_drift_samples_p95_rate_1h` — P95 rate over 1h
  - `arb_paper_drift_samples_rate_1m` — rate per minute
- **Alerts:** v1 (PaperDriftBpsHigh > 50 bps), v2 (PaperDriftBpsSustainedHigh > 30 bps for 15m)

#### P3-6: E2E Test & CI
- **E2E script:** `tools/e2e-phase3-paper-promotion.mjs` — extended with promotion approval, virtual capital reservation, paper trade cancel
- **CI job:** `e2e-phase3-paper-promotion` in GitHub Actions
- **Script wrapper:** `tools/ci-e2e-phase3-paper-promotion.sh`
- **Paper discovery E2E:** `tools/e2e-p3-paper-discovery.mjs`; CI job **`e2e-phase3-paper-discovery`**, wrapper `npm run ci:e2e-phase3-paper-discovery` (`tools/ci-e2e-phase3-paper-discovery.sh`)

- **Operator UI:** **`/paper`** and **`/tokens`** include paper trades, promotion candidates, drift samples, and discovery candidates with proper mutation flows
- **Paper quality:** Grafana dashboards (`arbibot-paper-trading.json`), drift alerts v1/v2, promotion candidate tracking, drift samples collection

### Config service (CFG-1, CFG-2, CFG-3 slice) — 2026-04-18

- **`@arbibot/config-service`** (default port **3019**): single-writer HTTP API for managed policy configuration with Redis cache and audit integration; persistence in Postgres via migrations **`019_policy_configurations.sql`** and **`020_policy_configuration_scopes.sql`** (apply with `npm run db:migrate`).
- **API endpoints (prefix `/policy`):**
  - `GET /configurations` — list (optional scope query); Redis-backed cache (~60s TTL) with DB fallback
  - `GET /configurations/:configKey` — single key (optional scope)
  - `GET /configurations/:configKey/effective` — resolved value with scope fallback (global → environment → tenant)
  - `GET /configurations/:configKey/history` — version history per scope
  - `POST /configurations`, `PUT /configurations/:configKey` — create/update (new row per change); body **`operatorId`** required (400 if missing); optional **`status`** `draft` \| `active` (default `active`)
  - `POST /configurations/:configKey/rollback` — rollback to a prior version (CFG-3)
  - `POST /configurations/:configKey/promote` — promote active row from one scope to another (CFG-3); optional **`idempotencyKey`**
  - `PATCH /configurations/:configKey/status` — activate latest draft in scope (`status: active`)
- **Sensitive keys:** pattern `risk.*`, `execution.*`, `capital.*` require **`approveReason`** on mutations.
- **Audit:** Mutations call **`AuditClientService.appendEntry`**.
- **BFF / UI:** **`CONFIG_API_BASE`** for **`/settings`**; optional **`ARBIBOT_DEV_OPERATOR_ID`** in env for stable audit actor in dev.
- **Docs:**
- Staged rollout nuances — [`docs/cfg-3-staged-rollout.md`](docs/cfg-3-staged-rollout.md)
- Service map — [`docs/services.md`](docs/services.md)
- Paper discovery config keys — [`docs/paper-discovery-config-keys.md`](docs/paper-discovery-config-keys.md)
- Review gate checklist — [`docs/review-gate-cfg3-paper-discovery.md`](docs/review-gate-cfg3-paper-discovery.md)
- Session summary — [`docs/session_summary.md`](docs/session_summary.md)
- **E2E:** Cache/audit verified manually; automated config E2E not required in root CI today.

### CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on Node **22**:

1. **build** — `npm ci`, then Turbo `lint`, `build`, `test` for the whole monorepo.
2. **`e2e-phase2`** — after `npm ci` + `npm run build`, runs `npm run ci:e2e-phase2` (Postgres service container + lab HTTP venue + built Nest apps — controlled execution chain).
3. **`e2e-phase2-watchlist-route-scoring`** — after `npm ci` + `npm run build`, runs `npm run ci:e2e-phase2-watchlist-route-scoring` (Postgres + **risk-service** — policy writer smoke).
4. **`e2e-phase3-paper-promotion`** — after `npm ci` + `npm run build`, runs `npm run ci:e2e-phase3` / `bash tools/ci-e2e-phase3-paper-promotion.sh` (Postgres + **paper-trading-service** + **opportunity-service**, paper promotion relay smoke).
5. **`e2e-phase3-paper-discovery`** — after `npm ci` + `npm run build`, runs `npm run ci:e2e-phase3-paper-discovery` / `bash tools/ci-e2e-phase3-paper-discovery.sh` (Postgres + **paper-trading-service** + **market-intake-service**, then `node tools/e2e-p3-paper-discovery.mjs`).
6. **`e2e-phase4-tier-routing`** — after `npm ci` + `npm run build`, runs `npm run ci:e2e-phase4-tier-routing` (Postgres + **risk-service** + **config-service** + **market-intake** + `tools/e2e-phase4-tier-routing.mjs`).
7. **`bus-smoke`** — after `npm ci`, runs `npm run ci:bus-smoke` (bridge build + optional Docker `--profile bus`; no full monorepo `npm run build` in this job).
8. **`secret-scan`** — after `actions/checkout` (no `npm ci` needed), runs `npm run ci:key-leakage` (`tools/ci-key-leakage.sh`); static grep for key-leakage patterns (K1/K2 from `dex-security-and-capital-safety` SKILL); **blocking since D4-B-7-SECRET-SCAN** (previously `continue-on-error: true`); complements `.github/gitleaks-config.toml` (pattern guard vs value guard).
9. **`graphify-check`** — after `build`, rebuilds knowledge graph, uploads `GRAPH_REPORT.md` as artifact (non-blocking, 7-day retention).
10. **`hermes-agent-smoke`** — after `npm ci`, runs `npm run ci:hermes-agent-smoke` (`tools/ci-hermes-agent-smoke.sh`); regression guard for hermes-agent wiring (correct `gateway run` command, MCP builds + stdio, config shape, doctor read-only); added 2026-07-22 after Plan 5 shipped "7/7 done" without the binary ever running. Real Telegram/GLM round-trip is NOT covered by CI (needs secrets) — manual DoD `H5-G-RUNTIME`.

**Review gate (documentation, not a CI job):** [`docs/review-gate-cfg3-paper-discovery.md`](docs/review-gate-cfg3-paper-discovery.md) — required items completed 2026-04-19; optional full bus E2E deferred.

### Frontend Documentation

- **`apps/web/FRONTEND_FIXES_SUMMARY.md`** — comprehensive summary of frontend architecture fixes (destructive operator actions, type consolidation, Tailwind migration, query invalidation strategy)
- **`apps/web/QUERY_INVALIDATION.md`** — complete React Query invalidation strategy for all dashboard queries (dashboard, incidents, opportunities, execution, portfolio, paper, settings)
- **`components/README-APPROVAL-FLOW.md`** — documentation for `DestructiveOperatorAction` component with usage examples and compliance checklist
- **`apps/web/components/settings-workspace.tsx`** — CFG-3 UI with promote/activate draft, draft checkboxes, Promote modal, DestructiveOperatorAction integration, React Query invalidation
- **`apps/web/components/degraded-status-banner.tsx`** — Phase 4 degraded signals banner (polling 30s, dismissible, operator layout integration)
- **`docs/review-gate-cfg3-paper-discovery.md`** — review gate checklist for CFG-3 UI and paper discovery integration (backend/frontend/architecture, metrics, bus-smoke optional)
- **`docs/phase4-prep-bridge.md`** — Phase 4 prep plan: CI, observability, offline export for watchlist/route analytics
- **`docs/route-scoring-replay.md`** — P4-4-SCORE: offline/staging replay for `route_scoring_history` (single-writer risk-service)
- **`docs/adr-phase4-clickhouse-gate.md`** — P4-4-CH: when to introduce ClickHouse / DWH for route-scoring analytics (no second writer)
- **`docs/adr-phase4-intake-throttling.md`** — ADR for Phase 4 intake throttling architecture (policy cache, fallback, single-writer)
- **`docs/phase4-ui-degraded-signals.md`** — Phase 4 degraded UI signals design (market-intake health, operator dashboard, banner)
- **`docs/intake-policy-config-keys.md`** — config JSON keys `intake.throttling` / `intake.routing.tiers` (Phase 4)
- **`docs/paper-promotion-quality-criteria.md`** — Paper promotion quality criteria (P2 prep)
- **`docs/hermes-operator-api-spec.md`** — hermes operator API specification (Phase 5 gateway)
