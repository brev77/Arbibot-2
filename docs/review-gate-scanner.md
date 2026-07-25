# Review gate: Scanner Service

> **Назначение:** чеклист review перед переводом фазы/шага в `done` и для release-gate scanner-service. Структура зеркалирует [`docs/review-gate-cfg3-paper-discovery.md`](review-gate-cfg3-paper-discovery.md) (backend/frontend/architecture/observability/paper-live), расширена под scanner.
> **Дата:** 2026-07-24. **Статус:** harness-документ, согласуется перед стартом разработки.
> **Источник:** [`.cursor/plans/DEVELOPMENT_PLAN-SCANNER.md`](../.cursor/plans/DEVELOPMENT_PLAN-SCANNER.md) (step_ids), [`docs/scanner-service-plan.md`](scanner-service-plan.md) (архитектура).

---

## Как использовать

Перед каждым `done` в `DEVELOPMENT_PLAN-SCANNER.md`:
1. Прогнать релевантные skills (backend-review / architecture-guard / dex-security / frontend-review).
2. Пройти чеклист фазы ниже.
3. Runtime smoke выполнен (см. [`docs/scanner-harness-runbook.md`](scanner-harness-runbook.md) §3).
4. Только после этого → `done`.

---

## Phase 0 — Contracts & Foundation

### Backend (`packages/contracts`, `packages/persistence`)

- [ ] `SERVICE_IDS.scannerService` + `SCANNER_HTTP_ROUTES` добавлены в `packages/contracts/src/index.ts`.
- [ ] `OpportunityDetectedPayloadV1` + `OPPORTUNITY_DETECTED_PAYLOAD_SCHEMA_VERSION=1` в `packages/contracts/src/events.ts`. Payload поля соответствуют `scanner-service-plan.md` Phase 0 (opportunityId, instrumentKey, routeKey, sourceModule, spreadBps, gross/netProfitUsd, feesUsd, volumeUsd, buyVenue, sellVenue, chainId, token, quoteAsset, evidence).
- [ ] `ScannerInstanceStatusEntity` (runtime-only, БЕЗ config-полей) + `ScannerFindingEntity` (incl. `publish_status`, `publish_attempts`) в `packages/persistence`, зарегистрированы в `ARBIBOT_TYPEORM_ENTITIES`.
- [ ] Миграция `<next>_scanner.sql` содержит таблицы + 4 индекса (observed_at, instance_id+observed_at, publish_status partial, opportunity_id).
- [ ] Seed-миграция `<next+1>_scanner_config_seed.sql` заполняет `scanner.defaults` + `scanner.instances` в `policy_configurations` (по образцу 032/035).

### Architecture

- [ ] Прогнать **architecture-guard-agent** — новые single-writer границы (`scanner_instances`, `scanner_findings` = scanner-service; `scanner.*` config = config-service) не конфликтуют с существующими.
- [ ] ADR `docs/adr-scanner-service.md` создан, описывает single-writer границы + payload-контракт + RPC rate budget rationale.

### Verify

- [ ] `npm run build` green (contracts + persistence + existing packages).
- [ ] `npm run db:migrate` на чистой БД применяет новые миграции без ошибок.
- [ ] `node tools/verify-migrations-applied.mjs infra/postgres/migrations/<next>_scanner.sql` pass.

---

## Phase 1 — scanner-service core

### Backend (`apps/scanner-service`)

- [ ] Прогнать **backend-review-agent** по `apps/scanner-service/`: NestJS/Fastify, schema review, single-writer (`scanner_instances`/`scanner_findings` только scanner пишет).
- [ ] `main.ts` вызывает `installMetricsOnFastify` с явным `serviceName: 'scanner-service'` (как все Nest-приложения — см. observability check в `review-gate-cfg3-paper-discovery.md`).
- [ ] Worker skeleton (mirror `paper-discovery-worker.ts`): `OnModuleInit/OnModuleDestroy` + `setInterval(...).unref()` + `isRunning` guard.
- [ ] Config loader (mirror `paper-discovery.service.ts:255-289`): TTL cache, env fallback, `SCANNER_CONFIG_CACHE_TTL_MS`.
- [ ] RPC layer: read-only provider (без wallet/key), **rate limiter** (`SCANNER_RPC_RATE_LIMIT_RPS`), fallback `RPC_*_URL`.
- [ ] Pool Reader: V2 getReserves, V3 slot0+liquidity, `pool.factory()` mapping. **Собственный `UNI_V3_POOL_SCANNER_ABI`** с `volumeToken0/1`.
- [ ] Volume Reader: V3 cumulative (mainnet-canonical, graceful revert) + V2 short-window eth_getLogs. **Swap topic0 compute via `ethers.id()`** (не hardcode).
- [ ] Factory mapping table: uniswap-v2, sushiswap (incl. Arbitrum `0xc35DADB65012eC4126586465b0d79A6a5A93026C`), pancakeswap-v2, biswap.

### Architecture

- [ ] Прогнать **architecture-guard-agent**: scanner НЕ дублирует EO `PoolDiscoveryService` (разный use-case: detection vs execution).
- [ ] Scanner НЕ владеет ничем кроме `scanner_instances`/`scanner_findings`/`arb_scanner_*` metrics.

### Security (DEX / capital safety)

- [ ] Прогнать **dex-security-and-capital-safety**: scanner НЕ импортирует wallet/key path (`WalletManagerService`, `KeyVaultService`, `getEncryptedKey`, `decryptPrivateKey`); read-only RPC; paper/live boundary.
- [ ] `bash tools/ci-paper-live-boundary.sh` pass (после расширения под scanner в Phase 5 — или локальная проверка импортов сейчас).

### Observability

- [ ] Metrics `arb_scanner_*` с `registers:[getArbibotMetricsRegistry()]` (не defaultRegistry).
- [ ] `GET /health` composite (RPC + config + worker status).
- [ ] `GET /metrics` отдаёт `arb_scanner_cycles_total`, `arb_scanner_rpc_latency_ms`, `arb_scanner_rpc_rate_limited_total`, `arb_scanner_volume_revert_total`.

### Verify + runtime

- [ ] `npm run build -w @arbibot/scanner-service` green.
- [ ] `npm run lint -w @arbibot/scanner-service` 0 errors.
- [ ] Unit tests: config loader, worker, RPC rate limiter, pool reader, volume reader.
- [ ] **Runtime DoD** (по аналогии H5-G-RUNTIME — см. `scanner-harness-runbook.md` §3 Phase 1): сервис стартует, `/health` 200, worker крутит циклы, RPC read работает на whitelisted pools.

---

## Phase 2 — Cross-DEX engine

### Backend

- [ ] Прогнать **backend-review-agent**: spread math, filter engine, dedup.
- [ ] Spread Detector: net profit = gross − pool fees − gas estimate (БЕЗ slippage — тот в execution `SlippageProtectionService`).
- [ ] Filter engine переиспользует типы `packages/contracts/src/dex-filters.types.ts` где уместно.
- [ ] Dedup cooldown per `(canonical_token, buy_venue, sell_venue)`.

### Verify

- [ ] Unit tests: spread math (edge cases: zero spread, negative net), each filter (AND-combination, enabled toggle), dedup cooldown (window, expiry bypass).
- [ ] Integration test: full pipeline cycle на whitelisted pools → findings written, instances updated.

---

## Phase 3 — Integration

### Backend (scanner-service)

- [ ] Прогнать **backend-review-agent**: opportunity publisher, retry, orphan worker.
- [ ] Opportunity publisher: `POST /opportunities` с rich payload (заполняет поля, сегодня читаемые с `?? 0` в `opportunities.service.ts:363-370`).
- [ ] Graceful degradation: retry (3 attempts, exp backoff) + `publish_status`/`publish_attempts` + orphan retry worker (max 5 cumulative) + `POST /scanner/findings/:id/re-publish`.
- [ ] Metric `arb_scanner_opportunity_publish_failed_total{instance,reason}`.

### Backend (opportunity-service — Phase 3b)

- [x] Прогнать **backend-review-agent** по изменённому `opportunities.service.ts` — **PASS** (2026-07-25, S3-3): single-writer сохранён, outbox в той же tx, envelope schema полная.
- [x] `create()` обёрнут в `dataSource.transaction` + outbox `OpportunityDetected`.
- [x] **Primary образец `paperEnqueue()` (`opportunities.service.ts:199-319`)** — mirror структуры (tx + outbox + envelope). Не перескакивать в risk.service/snapshots.service.
- [x] Envelope fields по чеклисту `scanner-service-plan.md` Phase 3b (messageId, correlationId, causationId, entityType, entityId, version=1, sourceModule=opportunityService, eventName=opportunityDetected, payload, envelope, eventTs).
- [x] **Regression:** opportunity-service unit tests зелёные — 135/135 pass (8 suites), включая 9 новых outbox-тестов + все существующие create/enrich/paperEnqueue/requestRiskEvaluation.
- [x] ⚠️ Lifecycle `detected→risk_checked` НЕ драйвится через `OpportunityDetected` (требует `RiskDecisionIssued` — отдельный flow, уже работает). Событие чисто для наблюдаемости.

### Architecture

- [x] Прогнать **architecture-guard-agent**: scanner НЕ пишет `arbitrage_opportunities` напрямую (только через POST /opportunities). Opportunity-service остаётся single-writer — scanner-service не импортирует `ArbitrageOpportunityEntity`.
- [x] `OpportunityDetected` outbox — single-writer opportunity-service (не scanner).

### Verify + runtime

- [ ] Integration test: finding → POST /opportunities → opportunity persisted, id saved to `scanner_findings.opportunity_id`.
- [ ] Degradation: retry exhaustion → `publish_status=failed`, orphan worker re-publishes, manual re-publish.
- [ ] **Runtime smoke** (см. `scanner-harness-runbook.md` §3 Phase 3): live POST /opportunities round-trip + degradation + orphan republish.
- [ ] Phase 3b: outbox row `OpportunityDetected` появляется в `outbox_events` после create (SQL check).

---

## Phase 4 — Observability + Operator UI + Hermes

### Frontend (`apps/web`)

- [x] BFF routes `app/api/operator/scanners/*` проксируют через `scanner-bff.ts` helper с `getOperatorSession()` session-check + `x-operator-id` — **S4-2 done (2026-07-25)**: 8 routes (instances/findings GET, refresh-config/run/re-publish POST, status); build + lint green.
- [x] `scanner` добавлен в `apps/web/lib/api-base.ts` (`SCANNER_API_BASE`, default 3021).
- [x] Прогнать **frontend-review-agent** по `apps/web/app/(operator)/scanners/` UI + BFF routes — **PASS** (2026-07-25, S4-3-UI): React Query patterns (centralized query keys, invalidation on mutations, polling intervals), operator safety (Run/Refresh-config/re-publish — non-destructive, session-checked via BFF, disabled states), loading/error/empty states, theme-light/dark classes, aria-label на selects.
- [x] `/scanners` page: таблица инстансов (config join runtime, runtime status badge, Run/Refresh-config actions), findings drilldown (→ `/opportunities/[id]` link, Re-publish для pending/failed) — components: `scanners-workspace.tsx`, `scanner-instances-table.tsx`, `scanner-findings-table.tsx`, `scanner-types.ts`.
- [x] nav link в `operator-nav.tsx` с `minRole: 'operator'`.
- [x] `/settings`: `scanner.instances` + `scanner.defaults` уже видны в Extensions catalog (struct editor — backlog enhancement; JSON editor функционально покрывает управление сегодня).

### Observability

- [x] Все `arb_scanner_*` metrics отдаются на `/metrics` (cycles, findings, spread_bps, volume_usd, rpc_latency, rpc_rate_limited, publish_failed, orphan_republish, pool_cache_hit_ratio, volume_revert) — **S4-1 done (2026-07-25)**: 184/184 tests, build+lint green.
- [x] Metric `arb_scanner_opportunity_publish_failed_total{instance,reason}` — расширена с `{instance}` до `{instance,reason}` (reason: config/http_5xx/http_4xx/timeout/network/bad_response); publisher sole-owner failed-counter (orphan-worker больше не double-counts, использует `orphan_republish_total{status: success|failed|exhausted}`).
- [ ] (опц.) Dashboard summary widget: top active findings count.

### Hermes

- [x] Hermes Gateway read-through: `GET /hermes/v1/scanner/findings`, `/scanner/findings/:id`, `/scanner/status`. `getScannerApiBase()` в `hermes-env.ts` (`SCANNER_API_BASE`, default 3021) — **S4-4 done (2026-07-25)**.
- [x] MCP tool `list_scanner_findings` (+ `get_scanner_status`) в `packages/hermes-mcp-server/src/tools/scanner.ts` — 24 tools total (22→24); handler tests pass.
- [x] Hermes config mutation allowlist (`config-allowlist.ts`): добавлен `scanner.*` (operator может менять `scanner.instances`/`scanner.defaults` через Telegram).
- [x] Skill `tools/hermes-agent/skills/scanner-status.md` соответствует формату остальных skills (frontmatter name/description/readonly/tools + trigger patterns + call sequence + answer format).

### Verify

- [ ] `npm run build -w @arbibot/web` green.
- [ ] frontend-review-agent pass.
- [ ] `npm run ci:hermes-agent-smoke` pass (regression — Hermes wiring не сломан).
- [ ] MCP tool `list_scanner_findings` отвечает (manual smoke через MCP).

---

## Phase 5 — Config + Ops

### CI

- [ ] `tools/ci-scanner-smoke.sh` создан (по образцу `ci-hermes-agent-smoke.sh` — WHY/WHAT/WHAT-NOT структура).
- [ ] `npm run ci:scanner-smoke` pass локально + в GitHub Actions job `scanner-smoke`.
- [ ] `tools/ci-paper-live-boundary.sh` расширен: PL.3 (scanner не импортирует paper) + PL.4 (paper не импортирует scanner).
- [ ] `npm run ci:paper-live-boundary` pass.
- [ ] `tools/e2e-scanner-smoke.mjs` создан (по образцу `e2e-phase3-paper-promotion.mjs`); `npm run e2e:scanner-smoke` pass.

### Ops

- [ ] `tools/seed-scanner-config.mjs` создан; `npm run seed:scanner-config` upsert’ит `scanner.*`.
- [ ] Retention cleanup worker: `DELETE FROM scanner_findings WHERE observed_at < now() - interval '<findingsRetentionDays> days'`, hourly. Metric `arb_scanner_findings_cleaned_total`. Unit test: cleanup deletes old, keeps recent.
- [ ] PM2: `ecosystem.config.cjs` entry для scanner-service (mirror существующих). `pm2 start ... --only scanner-service` стартует.
- [ ] `docs/paper-deploy-aeza.md` обновлен (14-й сервис в pm2 stack).

### Architecture / docs

- [ ] Прогнать **architecture-guard-agent** — финальная проверка всех границ.
- [ ] `docs/architecture-components.md` обновлен: новый сервис в таблице §1, новые single-writer таблицы (`scanner_instances`, `scanner_findings`), `scanner.*` config в §12.
- [ ] `AGENTS.md` обновлен: порт 3021, env vars (Прил. A `scanner-service-plan.md`), npm scripts (`dev:scanner`, `build:scanner`, `e2e:scanner-smoke`, `ci:scanner-smoke`, `seed:scanner-config`), CI job `scanner-smoke`.
- [ ] `docs/scanner-runbook.md` создан (operator runbook — deploy, troubleshooting, monitoring).

---

## Cross-cutting (для всех фаз)

### Single-writer invariant (критично)

- [ ] Scanner пишет **только** `scanner_instances`, `scanner_findings`, in-memory pool-cache.
- [ ] Scanner НЕ пишет: `market_snapshots`, `arbitrage_opportunities` (только POST /opportunities), `risk_decisions`, `paper_*`, `execution_*`, `capital_*`, `dex_daily_volume`, `dex_pools`.
- [ ] Config (`scanner.*`) — single-writer config-service (scanner только читает).

### Paper/live isolation

- [ ] Scanner НЕ импортирует `@arbibot/paper-trading-service`, paper-модули.
- [ ] Scanner НЕ импортирует wallet/key path (`WalletManagerService`, `KeyVaultService`, `getEncryptedKey`, `decryptPrivateKey`).
- [ ] RPC provider — read-only (без wallet, без sign).
- [ ] `ci-paper-live-boundary.sh` pass (после расширения).

### Service auth

- [ ] Все outbound HTTP — через `signedFetch` (header `x-arbibot-signature`).
- [ ] `ARBIBOT_SERVICE_AUTH_SECRET` / `ARBIBOT_SERVICE_AUTH_ENABLED` в env (как все сервисы).

### Git workflow

- [ ] Commits через git-workflow-agent: structured commits, linked to step_id (напр. `S1-5-POOL`), direct-to-main, scoped validation (build/lint/test для code; `verify:env` для config; none для docs).

---

## Связанные документы

- [`docs/scanner-service-plan.md`](scanner-service-plan.md) — архитектура (17 решений, 5 раундов ревью).
- [`.cursor/plans/DEVELOPMENT_PLAN-SCANNER.md`](../.cursor/plans/DEVELOPMENT_PLAN-SCANNER.md) — step_ids.
- [`docs/scanner-harness-runbook.md`](scanner-harness-runbook.md) — CI/e2e/verify процессы.
- [`docs/review-gate-cfg3-paper-discovery.md`](review-gate-cfg3-paper-discovery.md) — образец review-gate.
- [`docs/architecture-components.md`](architecture-components.md) — canonical карта компонентов.

---
*v1.0 — 2026-07-24*
