# Arbibot 2

## Cursor / agent instructions

### Cursor Skills (`.cursor/skills/`)

| Skill | Назначение | Команда |
|---|---|---|
| architecture-guard-agent | Валидация против системной архитектуры: service boundaries, single-writer, reservation-first, outbox/inbox, reconciliation, paper/live isolation, operator approval, OpenAPI/AsyncAPI, DEX-инварианты | `/architecture-guard` |
| backend-review-agent | Backend review: NestJS/Fastify, single-writer, ExecutionPlan state machine, event envelopes, DEX-specific (ethers.js, RPC, gas, slippage, on-chain entities) | `/backend-review` |
| frontend-review-agent | Frontend review: App Router, React Query, Zustand, shadcn/ui, TanStack Table, operator safety, RBAC, destructive flows, DEX-specific UI | `/frontend-review` |
| git-workflow-agent | Git-операции: direct-to-main политика (feature-ветки опциональны), structured commits по plan step_id, scoped pre-commit validation, Windows path safety | `/git-workflow` |
| dex-security-and-capital-safety | DEX/on-chain/cross-chain hardening: key leakage (K), tx replay/MEV/slippage (T), bridge (B), capital exposure/kill-switch (C), approvals (A); RED-zone operator approval; paper→live boundary | `/dex-security` |

**Workflow:** изменения через границы сервисов / критичные flows — architecture-guard до коммита; PR-ревью — backend/frontend-review по зоне; всё что DEX/кошельки/ключи/мосты/капитал/paper→live — дополнительно dex-security; **все Git-операции — через git-workflow-agent**.

### graphify (knowledge graph)

`graphify-out/` в `.gitignore`, генерируется локально. Гайд — [`docs/graphify-guide.md`](docs/graphify-guide.md).

- `npm run graphify:rebuild` — AST-only rebuild (~30 сек); `graphify:query -- "вопрос"` — query; `graphify:report` — отчёт
- Прямая команда (Windows `py -3`): `py -3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"`; full graph — `/graphify .` в Cursor

**Когда использовать:** перед планированием/реализацией шага — `graphify:query` для навигации (callers, single-writer boundaries, communities) **до** запуска Explore-агентов: локальный AST-grep стоит ~0 токенов против десятков–сотен K у агентов. Порядок: rebuild (если watch-хук не сработал) → query → точечное чтение функций (не целых файлов). Также перед `/review-step` и deployment. CI job `graphify-check` (non-blocking).

### Overview

**Domain glossary:** [`CONTEXT.md`](CONTEXT.md) — канон доменных терминов (ubiquitous language). Обновлять inline при разрешении новых терминов; CONTEXT.md (что термины значат) и AGENTS.md (как запускать/настраивать) не перекрываются.

Arbibot 2 — **Turborepo monorepo** (npm workspaces: `apps/*`, `packages/*`):

- **Backend:** NestJS HTTP-сервисы на **Fastify** + **TypeORM** (PostgreSQL), optional Redis, Prometheus через `@arbibot/nest-platform`.
- **Operator UI:** Next.js App Router в **`apps/web`**.

Каталогов `core-backend/` / `operator-frontend/` **нет** — старые доки/аудиты могут так называть текущий layout.

## Status (2026-08-15)

**Проект feature-complete** (планы 1–13 + DEX — код доставлен). **Live bot HALTED с 2026-08-11** (`panic:stop` на Aéza: `DEX_LIVE_KILL_SWITCH=true`, auto-drive воркеры выключены; recover сознательно не поднимает auto-drive флаги). Первый реальный round-trip дал −$0.11, и **single-chain retail arb на Arbitrum измеренно нежизнеспособен** — 4 независимых зонда: $10 → 0/7 прибыльных; $1000 → 0/7 (slippage доминирует); best-cross-pool-routing → −12 bps = fee-floor; Camelot V3 → 0/72. **Активный workstream** — discovery-driven multi-chain dry-run probe (Arbitrum+Base+Optimism, live с 2026-08-14; сбор без полосы ликвидности): **PLAN14** (#52–#58; 2026-08-18: #52+#53 done live, #56/#57 review live — сырьевой тир trigger-driven (цикл ~150 c), далее #58 event-триггеры, #54 FilterLab ([`docs/plan-probe-crosschain-autotune-2026-08-17.md`](docs/plan-probe-crosschain-autotune-2026-08-17.md)); paper-стек остановлен (2026-08-17). Открытое продуктовое решение: закрыть / pivot к cross-chain-MEV / расширить probe.

| План | Что | Статус |
|---|---|---|
| Phase 0–2 | foundation + controlled execution | done ✅ |
| Phase 3 | paper trading engine | done ✅ |
| Phase 4 | wide-universe scaling (`P4-4-*`) | done ✅ |
| Phase 5 | hermes-assisted operations (`P5-5-*`) | done ✅ |
| DEX-1/2/DOC | DEX + cross-chain adapters (46/46) | done ✅ |
| Plan 3 | hermes Agent + MCP Server (17/17) | done ✅ |
| Plan 4 / D4 | deploy-readiness (20/22; B-8 descoped, C-4 blocked) | delivered ✅ |
| Plan 5 | hermes → GLM 5.2 + Telegram (7/7; runtime DoD PASS) | done ✅ |
| Plan 6 | hermes → управление настройками (10/10; sensitive-ключи 403) | done ✅ |
| Plan 7 | live-blocker infrastructure sweep (8/8) | done ✅ |
| Plan 8 | correctness sweep + live-gate enablement (5/5) | done ✅ |
| Plan 9 | single-chain Arbitrum live-readiness (13 шагов) | код доставлен; ⏸ P9-12 ops prereq |
| Plan 10 | live auto-execution (#35–#44) | код доставлен; ⏸ P10-9 smoke |
| Plan 11 | post-Hermes live-correctness (#45–#47) | done ✅ |
| Plan 12 | amountIn USD oracle (#48) | done ✅ |
| Plan 13 | slippage gate + gas leak + native wrap (#49–#51) | done ✅ |

Детали — в [`.cursor/plans/DEVELOPMENT_PLAN.md`](.cursor/plans/DEVELOPMENT_PLAN.md) и соседних `DEVELOPMENT_PLAN*.md` (планы 1–10); планы 11–13 — в [`docs/plan-hermes-live-correctness-2026-08-06.md`](docs/plan-hermes-live-correctness-2026-08-06.md), [`docs/plan-amountin-usd-oracle-2026-08-10.md`](docs/plan-amountin-usd-oracle-2026-08-10.md), [`docs/plan-slippage-same-decimals-2026-08-10.md`](docs/plan-slippage-same-decimals-2026-08-10.md); инициативы #19–#51 — [`docs/roadmap-vectors.md`](docs/roadmap-vectors.md). ⚠️ Статус плана может отставать от кода — перед выводом «не реализовано» проверяй `git log --grep`.

**Открытые хвосты:** P9-12 (wallet/RPC/capital env на live-стенде); P10-9 (dedicated live-auto-drive smoke; пока переиспользуется `smoke:live-testnet`); P10-AMT #42 (runtime notional→amountIn = Phase 2); `FE-SETTINGS-POLICY-WORKSPACE` (implemented, awaiting `/review-step`). Cross-chain мосты — отдельный план: аудит 2026-08-12 подтвердил 9 багов bridge-адаптеров (неверные mainnet-адреса, fake Stargate ABI, false-positive L2→L1 completion, отсутствие prove/finalize), bridge venue keys halt'нуты.

**Safe-by-default флаги** (после panic все в безопасное состояние): `LIVE_AUTO_DRIVE_ENABLED=false`, `LEG_AUTO_DRIVE_ENABLED=false`, `PAPER_AUTO_DRIVE_ENABLED=false`, `DEX_LIVE_KILL_SWITCH`.

**Качество:** миграции **001–059**; свежий build/lint/test snapshot — CI (последний локальный полный прогон: EO 876/876, opp-service 201/201 на коммите `1a7894b`, 2026-08-10).

### Migrations (001–059)

Применяются лексикографически через `npm run db:migrate` (`tools/db-migrate.mjs`); полный список — `infra/postgres/migrations/`. Ключевые и неочевидные:

- **011** `reconciliation_mismatches` — reconciliation-таблица общего вида
- **015** token/route profiles + risk decision keys
- **016–023** paper: trades, enqueue idempotency, outbox dedup (`018`), policy configurations (`019`/`020` CFG scopes), capital reservations (`021`), discovery candidates (`022`/`023`)
- **024–028** execution playbooks, watchlist tier snapshots, route scoring history, paper drift route_key
- **029** seeds `intake.throttling` / `intake.routing.tiers`
- **032** seeds `dex.filters` — ⚠️ **legacy intake-фильтры, НЕ scanner config** (scanner = `044`/`045`, ключи `scanner.defaults` + `scanner.instances`, по умолчанию пустой)
- **033/034** DEX on-chain (`on_chain_transactions`, `wallet_states`, `dex_pools`, `approvals`; legId bigint→uuid)
- **035** seeds `dex.limits` + `dex.live`
- **036** `bridge_transfers` + cross-chain колонки — ⚠️ **таблицы `cross_chain_reconciliation` не существует** (`CrossChainReconciliationService` in-memory; общая recon-таблица = `reconciliation_mismatches`, миграция `011`)
- **037–043** D4: alertmanager incidents, dex daily volume, notional_usd, `capital.limits` seed, `wallet_keys`, bridge finality
- **044/045** scanner tables + config seeds
- **046/047** PAD: paper settlement колонки + `paper.auto_drive` seed (`enabled:false`)
- **048/049** execution cost breakdown + `dex.limits.minNetProfitUsd` ($0.50, LIVE-only)
- **050** hotfix: partial unique `WHERE state='active'` на `paper_capital_reservations` (over-broad UNIQUE валил AutoDrive каскадно; self-healing)
- **051/052** P9: UNIQUE(correlation_id)+sweeper; `submitting` state на `execution_legs`
- **053/054** P10: `live.auto_drive` seed (`enabled:false`); `arbitrage_opportunities.live_execution_plan_id` + partial index (дедуп)
- **055–058** probe: `dry_run_observations`, `dry_run_discovery`, bridge-fee колонки nullable; 058 (PLAN14 #52/#53) — `net_pp_bps`, `dry_run_run_stats` (gas/RPC-телеметрия, source cycle|event), `dry_run_arb_opportunities` (окна open→expired, partial-UNIQUE на open); 059 (PLAN14 #57) — `dry_run_raw_token_prices` (сырьевой тир: маргинальные цены из резервов, fee-adjusted спреды) + часовые агрегаты

Migration **020** rollback починен через **024**; применять по порядку на чистых БД. Canonical registry (`venue_refs`, `canonical_instruments`, `canonical_routes`) не auto-seeded — `npm run db:seed-canonical`.

## Infrastructure

PostgreSQL 16 + Redis 7: `docker compose -f infra/docker-compose.dev.yml up -d` (Postgres на host-порту **15432**, чтобы отдельный localhost:5432 не перехватывал `DATABASE_URL`; CI использует 5432 внутри job). Kafka-шина (Redpanda): `--profile bus`.

- **DB migrator sidecar (P7-1):** в `infra/docker-compose.prod.yml` one-shot `migrator` применяет миграции до старта сервисов — ручной `db:migrate` в prod не нужен ([`docs/deployment-guide.md`](docs/deployment-guide.md) §7).
- **Backup sidecar (P7-2):** cron-сайдкар с `tools/backup-postgres.sh`, daily 02:00 UTC, HEALTHCHECK по маркеру ([`docs/disaster-recovery-plan.md`](docs/disaster-recovery-plan.md) §2.2).
- **Windows + Nest:** держи `@nestjs/cli` 11.0.21+ и локальные npm-скрипты (не глобальный `nest`); артефакты под `apps/<service>/dist/` — при «successful build» без `dist/main.js` проверь cwd и сравни с `npx tsc -p apps/<service>/tsconfig.build.json`. Build/start/start:dev = `tsc -p tsconfig.build.json` + `node dist/main.js` + `concurrently`-watch-loop; `nest-cli.json` = `"builder": "tsc"`.

Env: копируй [`.env.example`](.env.example) → `.env`. Типичный Nest env: `PORT`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGINS`, `KAFKA_BROKERS`, `ARBIBOT_DEV_ROLE` (+ `ARBIBOT_DEV_OPERATOR_ID` для audit в dev); service-to-service: `RISK_SERVICE_URL`, `PAPER_TRADING_SERVICE_URL`, `CONFIG_SERVICE_URL`; `apps/web` BFF — `*_API_BASE` ([`apps/web/lib/api-base.ts`](apps/web/lib/api-base.ts)).

## Root workspace

- `npm ci` / `lint` / `build` / `test` — Turbo на весь monorepo
- `db:migrate`; `db:verify-migrations[:all]` — проверить applied
- `db:backup` / `db:restore` — dump/restore Postgres
- `verify:env` — валидация `.env` для prod/paper (fail-closed); `verify:deployment` — composite pre-deploy; `generate:tls` — self-signed TLS
- `verify:docs` — **docs-freshness guard**: 11 структурных проверок (диапазоны миграций, счётчики skills/tools, мёртвые ссылки/пути, ENV-ссылки, возраст штампа верификации AGENTS.md); ⚠️ structural-only, семантический drift не ловит. CI job `docs-freshness`; pre-commit hook (blocking Linux/Mac, advisory Windows)
- `panic:stop` / `panic:recover` — **unified emergency-stop** (`DEX_LIVE_KILL_SWITCH=true` + auto-drive флаги в `false`; recover НЕ восстанавливает auto-drive)
- **E2E (нужны поднятые сервисы):** `e2e:phase1-foundation`, `e2e:phase2-controlled-execution`, `e2e:phase2-watchlist-route-scoring`, `e2e:phase3-paper-promotion`, `e2e:phase4-tier-routing`, `e2e:paper-auto-drive`, `e2e:dex2-multichain`, `e2e:dex-testnet`, `e2e:scanner-smoke`
- **CI-обёртки:** `ci:e2e-phase2`, `ci:e2e-phase2-watchlist-route-scoring`, `ci:e2e-phase3`, `ci:e2e-phase3-paper-discovery`, `ci:e2e-phase4-tier-routing`, `ci:e2e-paper-auto-drive`, `ci:bus-smoke`, `ci:key-leakage`, `ci:paper-live-boundary`, `ci:hermes-agent-smoke`, `ci:scanner-smoke`
- **Live smoke:** `smoke:live-testnet` — DoD Gate 3 (capital rehearsal ≤$10 fail-closed + kill-drill + reconciliation; dry-run по умолчанию, `--testnet` = реальные tx) — [`docs/live-smoke-runbook.md`](docs/live-smoke-runbook.md)
- **Drills:** `drill:1` (paper incident), `drill:2` (reconciliation P0, MTTA/MTTR), `drill:3` (DR: backup→restore→RTO/RPO на отдельной `DRILL_TEST_DATABASE_URL`)
- **Bus:** `bus:publish` / `bus:consume`; seeds: `seed:outbox-smoke-events[:all]`, `seed:intake-policy-config`, `seed:scanner-config`, `db:seed-canonical`
- **Wallet:** `wallet:import` — безопасный импорт приватного ключа в `wallet_keys` (stdin/env, НЕ args — не светит в `ps`; AES-256-GCM; fail-closed address validation; ключ не логируется). Usage: `echo "0xKEY" | npm run wallet:import -- --key-id prod-arb-1 --chain-id 42161 --expected-address 0x...`
- **Hermes:** `build:hermes-mcp`, `doctor:hermes`, `run:hermes`
- **Probe:** `probe:dry-run` (continuous) / `probe:dry-run:once` — multi-chain dry-run (`PROBE_RPC_{ARBITRUM,BASE,OPTIMISM}_URL`, `PROBE_DATABASE_URL`); digest окон — `node tools/arb-digest.mjs [--hours 24]`
- **Прочее:** `venue:load-test`, `dex:load-test`, `export:route-scoring-history`, `replay:route-scoring-export`, `map:excalidraw` (регенерация `docs/system-map.excalidraw`), `dev:stack` (+ `dev:stack:hermes-agent`), `dev:scanner` (build — `npm run build -w @arbibot/scanner-service`)

### Backend services (`apps/*`)

| App | PORT | App | PORT |
|---|---|---|---|
| risk-service | 3000 | portfolio-service | 3016 |
| opportunity-service | 3010 | reconciliation-service | 3017 |
| capital-service | 3011 | paper-trading-service | 3018 |
| execution-orchestrator | 3012 | config-service | 3019 |
| audit-service | 3013 | hermes-gateway | 3020 |
| canonical-market-service | 3014 | scanner-service | 3021 |
| market-intake-service | 3015 | | |

Запуск: `npm run start:dev -w @arbibot/<name>` или root-скрипты `dev:risk`, `dev:opportunity`, `dev:capital`, `dev:execution`, `dev:audit`, `dev:canonical`, `dev:intake`, `dev:portfolio`, `dev:reconciliation`, `dev:paper`, `dev:config`, `dev:hermes`, `dev:scanner`, `dev:web`.

Shared-пакеты ([`packages/`](packages/)): `@arbibot/contracts`, `@arbibot/contracts-eth` (EVM ABI/адреса/типы), `@arbibot/persistence`, `@arbibot/messaging`, `@arbibot/nest-database`, `@arbibot/nest-platform`, `@arbibot/outbox-kafka-bridge`, `@arbibot/hermes-mcp-server` (25 tools → gateway).

### Сервисные заметки

- **Outbox-релэй opportunity-service** (`OutboxRelayService`): форвардит `RiskDecisionIssued` и `PaperPromotionCandidateRequested` в paper-trading-service по HTTP (outbox-first). У релея и Kafka-моста **свои allowlists** event-типов — Kafka не покрывает relay-only типы; не дабл-паблишить одну доставку ([`docs/outbox-inbox.md`](docs/outbox-inbox.md)).
- **Config-service** (single-writer policy API, prefix `/policy`): `GET /configurations[/:key[/effective|/history]]`, `POST/PUT /configurations[...]` (тело требует `operatorId`), `POST .../rollback|promote`, `PATCH .../status` (activate draft). Sensitive-ключи (`risk.*`, `execution.*`, `capital.*`) требуют `approveReason`; мутации аудируются. Scope fallback: global → environment → tenant.
- **Risk-service policy:** read `GET /policy/watchlist/tiers`, `GET /policy/route-scoring-history/:routeKey`; jobs `POST /policy/jobs/watchlist-tiering|route-scoring` (триггер `x-arbibot-job-trigger` + `RISK_POLICY_JOB_TRIGGER_TOKEN`); `POST /evaluate-risk` принимает `adaptiveRisk` + `instrumentKey`/`routeKey`.
- **Intake (Phase 4):** `IntakeThrottleService` — 429 + `{throttled:true}` (не silent drop); `GET /health/degradation` → `{degraded, fallbackMode, degradationReasons}`; ключи `intake.throttling` / `intake.routing.tiers`.
- **Paper-trading-service:** single-writer для paper trades / promotion candidates / drift / discovery; virtual capital полностью изолирован от live capital-service; AutoDrive pipeline (`promoted → draft → (opt-in) active → settled`) за kill-switch `PAPER_AUTO_DRIVE_ENABLED`; promotion остаётся за оператором.
- **State machines:** `execution_legs.state`: `created, submitting, sent, acknowledged, partiallyFilled, filled, rejected, canceled, timedOut, failed`; `execution_plans.state`: `planned, reserved, armed, executing, completed, hedged, unwound, failed, canceled` (значения `created` в plans **нет**).
- **DEX:** 5 своп-адаптеров (UniV2/SushiV2/PancakeV2/BiswapV2/UniV3) + 3 bridge-адаптера (Across, Stargate, Native L2; ⚠️ часть mainnet-адресов/ABI неверна — bridge venue keys halt'нуты до отдельного cross-chain плана). `MultiLegPlanBuilder` — multi-leg планы; `CrossChainReconciliationService` — in-memory.

### Frontend (`apps/web`)

- Конвенции: [`apps/web/STACK-CONVENTIONS.md`](apps/web/STACK-CONVENTIONS.md); lint/build/dev — `npm run … -w @arbibot/web` (порт 3000 занят risk-service — бери `PORT=3001`)
- BFF-прокси через `*_API_BASE` env — префиксы RISK / OPPORTUNITY / CAPITAL / EXECUTION / AUDIT / CONFIG / PORTFOLIO / RECONCILIATION / PAPER / MARKET_INTAKE / SCANNER

**BFF routes:** `/api/operator/dashboard/summary`; paper mutations `/api/operator/paper/trades/[id]?action=approve|reject|cancel` и `/api/operator/paper/promotion-candidates/[id]?action=approve|reject`; paper history/stats `/api/operator/paper/trades/history|stats`; settings `/api/operator/settings/configurations[…]` (+ `/effective`, `/history`, `/rollback`, `/promote`, `/status`, `/watchlist-tiers`, `/route-scoring/[routeKey]`); health `/api/operator/health/degradation|dex`; hermes `/api/operator/hermes/v1/[[...path]]` (GET/POST/PATCH; мутации требуют operator session, inject `operatorId`).

**UI routes:** `/dashboard`, `/portfolio`, `/opportunities`, `/execution`, `/tokens`, `/paper`, `/incidents`, `/runbooks`, `/hermes`, `/settings`.

**Operator session:** signed JWT cookie `arbibot_session`, выдаётся `POST /api/auth/session` по `OPERATOR_BOOTSTRAP_TOKEN`; `ARBIBOT_DEV_ROLE` — no-op в production. На plain-HTTP paper-хосте через SSH-туннель ставь `OPERATOR_COOKIE_SECURE=false`, иначе браузер дропает Secure cookie ([`docs/adr-operator-auth.md`](docs/adr-operator-auth.md)).

### Hermes Agent + MCP Server

- **MCP Server:** `packages/hermes-mcp-server/` — 25 tools via stdio → hermes-gateway (14 operational + 1 alertmanager + 8 config-management + 2 scanner). Env: `HERMES_MCP_PORT` (4000), `HERMES_AGENT_API_KEY`.
- **Agent:** `tools/hermes-agent/` — GLM 5.2 (Z.AI, OpenAI-совместимый endpoint) + личный Telegram-бот (whitelist `OPERATOR_TELEGRAM_ID`). **15 skills** — список и таблица cron↔skill: [`docs/hermes-reference.md`](docs/hermes-reference.md).
- **Конфиг:** каноничный — `hermes-config.yaml` (inline `agent.mcp:` block; его читает `run-hermes-agent.mjs`). `mcp-config.json` — ⚠️ **legacy-артефакт Plan 3**, рантайм его НЕ читает (оставлен для внешних MCP-клиентов).
- **Runtime (Plan 5, PASS 2026-07-22 на Aéza):** агент запускается `hermes gateway run` (НЕ `hermes run`); pipeline Operator→Telegram→Agent→GLM→MCP→Gateway работает end-to-end. CI `ci:hermes-agent-smoke` ловит wiring-регрессии; реальный Telegram/GLM round-trip — ручной DoD `H5-G-RUNTIME`.
- **Env:** `HERMES_LLM_PROVIDER/MODEL/BASE_URL/API_KEY`, `HERMES_TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`, `OPERATOR_TELEGRAM_ID`, `HERMES_GATEWAY_PORT`, `HERMES_API_KEYS`, `HERMES_GATEWAY_URL` + `HERMES_BFF_API_KEY` (web BFF), `HERMES_SIGN_UPSTREAM`, `OPERATOR_WEB_BFF_BASE`. ADR: [`docs/adr-hermes-agent-glm-telegram.md`](docs/adr-hermes-agent-glm-telegram.md).
- **Config-management (Plan 6):** hermes меняет только безопасные ключи (`intake/paper/opportunity/dex/features`); sensitive (`risk/execution/capital`) — gateway 403 ([`docs/adr-hermes-config-management.md`](docs/adr-hermes-config-management.md)).

### Ключевые env (группами; полный список — [`.env.example`](.env.example))

- **Live-gate / capital:** `DEX_LIVE_KILL_SWITCH`, `DEX_VENUE_ENABLED`, `CAPITAL_MAX_ACTIVE_USD`, `LIVE_AUTO_DRIVE_ENABLED`, `LEG_AUTO_DRIVE_ENABLED`, `PAPER_NOTIONAL_USD`, `DEX_KILL_SWITCH_CACHE_TTL_MS`
- **Vault:** `PRIVATE_KEY_ENCRYPTION_KEY`, `VAULT_MASTER_KEY_SALT` (обязательны в prod, fail-closed; [`docs/adr-vault-salt.md`](docs/adr-vault-salt.md))
- **Auth:** `OPERATOR_SESSION_SECRET`, `OPERATOR_BOOTSTRAP_TOKEN`, `OPERATOR_SESSION_TTL_SECONDS`, `OPERATOR_COOKIE_SECURE`
- **Logging:** `LOG_LEVEL`, `ARBIBOT_LOG_PRETTY`

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml), Node 22:

1. **build** — npm ci + Turbo lint/build/test
2–6. **e2e-phase2** / **e2e-phase2-watchlist-route-scoring** / **e2e-phase3-paper-promotion** / **e2e-phase3-paper-discovery** / **e2e-phase4-tier-routing** — Postgres + соотв. сервисы + e2e-скрипты
7. **bus-smoke** — build моста + опциональный Docker profile bus
8. **secret-scan** — блокирующий static-grep ключей/мнемоник (`ci:key-leakage`) + `.github/gitleaks-config.toml` (pattern vs value guard)
9. **graphify-check** — rebuild графа, artifact (non-blocking)
10–12. **hermes-agent-smoke** / **scanner-smoke** / **e2e-paper-auto-drive** — wiring-регрессии агента, статические scanner-проверки, AutoDrive e2e с P/L
13. **docs-freshness** — структурный drift-guard foundational docs (отдельный workflow: path-filtered + weekly cron; `continue-on-error` до 2026-08-25, затем блокирующий)

## Ключевые доки

- [`CONTEXT.md`](CONTEXT.md) — доменный глоссарий; [`docs/DOCUMENTS_INDEX.md`](docs/DOCUMENTS_INDEX.md) — индекс всех доков
- [`docs/roadmap-vectors.md`](docs/roadmap-vectors.md) — инициативы; [`docs/TODO.md`](docs/TODO.md) — operational backlog; [`docs/services.md`](docs/services.md) — карта сервисов
- [`docs/live-deploy-dod.md`](docs/live-deploy-dod.md) + [`docs/live-smoke-runbook.md`](docs/live-smoke-runbook.md) — live DoD gates; [`docs/adr-live-gate.md`](docs/adr-live-gate.md) — live-gate ADR (kill-switch + `DEX_VENUE_ENABLED`)
- [`docs/deployment-guide.md`](docs/deployment-guide.md) / [`docs/disaster-recovery-plan.md`](docs/disaster-recovery-plan.md) — deploy/DR; [`docs/paper-deploy-aeza.md`](docs/paper-deploy-aeza.md) — Aéza (pm2); [`docs/security-accepted-risks.md`](docs/security-accepted-risks.md) — Dependabot/overrides
- [`docs/hermes-reference.md`](docs/hermes-reference.md) / [`docs/hermes-operator-boundaries.md`](docs/hermes-operator-boundaries.md) — hermes функции и границы API
- [`docs/outbox-inbox.md`](docs/outbox-inbox.md) — outbox/inbox-контракт; [`docs/dex-runbook-bridge.md`](docs/dex-runbook-bridge.md) / [`docs/dex-rollback-strategy.md`](docs/dex-rollback-strategy.md) — bridge-операции и rollback

**Первичный запуск (paper → live):** paper trading — обязательный сквозной тест стека и накопление статистики без реальных потерь; после приёмки — live с минимальным капиталом (зафиксировано в `DEVELOPMENT_PLAN.md`, раздел «Операционная последовательность первичного запуска»).

## Maintenance

- **AGENTS.md + ключевые доки (список в секции «Ключевые доки», 16 файлов) верифицируются каждые 3 дня, источник — КОД репозитория** (`package.json`, `apps/*/src/main.ts`, `infra/postgres/migrations/`, роуты `apps/web/app/api`, plan-доки + `git log`), **не другие доки**; для каждого дока — его специфичные утверждения (services.md — порты/эндпоинты; hermes-reference — skills/cron-таблица; outbox-inbox — allowlists; adr-live-gate — kill-switch/флаги; live-deploy-dod — gates); датируемые снапшоты (`docs/*-2026-*.md`, audit/review) не правятся — их диапазоны легитимно исторические. Факты вне репо (ops-события, результаты зондов) помечаются memory-sourced и не выдумываются.
- **Лимит 200 строк**: при превышении деталь переносится в `docs/` (см. DOCUMENTS_INDEX), не удаляется молча. После правок — `npm run verify:docs` (EXIT=0). Повторяющаяся проверка — cron-задача агента каждые 3 дня; правки cron-прогона не коммитятся, остаются на ревью. **Enforcement:** штамп старше 3 дней при наличии коммитов с даты штампа → FAIL check 11 в `verify:docs`/CI.
- Last verified against code: 2026-08-18.
