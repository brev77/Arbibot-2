# Arbibot 2 — План: Scanner Service (cross-DEX детектор)

**Прогресс:** ✅ **24/24 — ВСЕ ФАЗЫ ЗАВЕРШЕНЫ** (Phase 0-5) | **Обновлено:** 2026-07-25 | **Детали шагов:** интегрированы в индекс ниже (план компактный, без подпапок шагов).

> **Статус плана:** ✅ **Phase 0-5 полностью завершены.** Scanner-service — feature-complete: cross-DEX spread detector → POST /opportunities, metrics + UI + Hermes + CI + ops readiness. Awaiting product decision for live RPC + pool whitelist deployment.
> **Архитектурный план-источник:** [`docs/scanner-service-plan.md`](../../docs/scanner-service-plan.md) (v4, 17 зафиксированных решений).
> **Harness-спутники:** [`docs/scanner-harness-runbook.md`](../../docs/scanner-harness-runbook.md) (CI/e2e/verify процессы), [`docs/review-gate-scanner.md`](../../docs/review-gate-scanner.md) (review-gate чеклист).

---

## Контекст

Новый сервис **`apps/scanner-service`** (порт 3021) — автономный детектор cross-DEX spreads, режимонезависимый data-provider. Запустили → ищет → `POST /opportunities` → STOP. Решение live/paper — в существующем pipeline. Сканер **не дублирует** существующие single-writer границы (см. `scanner-service-plan.md` §1, §4).

**Что уже есть в репо и переиспользуется (НЕ дублировать):**
- Worker skeleton: `apps/paper-trading-service/src/paper-discovery/paper-discovery-worker.ts`
- Config loader (TTL cache): `paper-discovery.service.ts:255-289`
- Outbox tx pattern (для Phase 3b): `opportunities.service.ts:199-319` (`paperEnqueue`)
- Metrics (shared registry): paper-discovery-worker.ts:28-60
- `signedFetch`, `getArbibotMetricsRegistry`, `AuditClientService`: `@arbibot/nest-platform`

**Что отсутствует (greenfield):** cross-DEX spread detection, per-venue RPC pricing, V3 cumulative volume, factory mapping, `scanner.*` config, `OpportunityDetected` продюсер.

## Целевой профиль

| Параметр | Значение |
|----------|----------|
| Сервис | `apps/scanner-service` (`@arbibot/scanner-service`), порт 3021 |
| Стратегии MVP | Same-chain 2-venue (buy venue A → sell venue B, одна сеть) |
| Источник цен | On-chain RPC (`RPC_SCANNER_*_URL`, изолированный budget от execution) |
| Volume | V3 cumulative (`volumeToken0/1`) + V2 short-window eth_getLogs; дефолт OFF |
| Хранение | `scanner_instances` (runtime-only) + `scanner_findings` (data) |
| Конфиг | Всё в config-service (`scanner.defaults`, `scanner.instances`) |
| Интеграция | `POST /opportunities` (rich payload) → STOP; Phase 3b оживляет `OpportunityDetected` |
| ADR | `docs/adr-scanner-service.md` (S0-0) |

---

## Статусы фаз

### Phase 0 — Contracts & Foundation (shared packages)

| step_id | Суть | status | DoD |
|---------|------|--------|-----|
| `S0-0-ADR` | ADR `docs/adr-scanner-service.md`: архитектура, single-writer границы, payload-контракт `OpportunityDetected`, RPC rate budget rationale | done | ADR создан, ссылка из `architecture-components.md` §1 |
| `S0-1-CONTRACTS` | `packages/contracts/src/index.ts`: `scannerService` в `SERVICE_IDS` + `SCANNER_HTTP_ROUTES` | done | build green, contracts unit test (если есть) |
| `S0-2-EVENTS` | `packages/contracts/src/events.ts`: `OpportunityDetectedPayloadV1` + `OPPORTUNITY_DETECTED_PAYLOAD_SCHEMA_VERSION=1` | done | `events.ts` compiles, payload тип соответствует `scanner-service-plan.md` Phase 0 |
| `S0-3-ENTITY` | `packages/persistence`: `ScannerInstanceStatusEntity` (runtime-only) + `ScannerFindingEntity` (incl. `publish_status`, `publish_attempts`) + регистрация в `ARBIBOT_TYPEORM_ENTITIES` | done | persistence package builds, entities в index |
| `S0-4-MIGRATION` | `infra/postgres/migrations/044_scanner.sql`: таблицы + 4 индекса (observed_at, instance_id+observed_at, publish_status partial, opportunity_id) | done | файл создан; `npm run db:migrate` на чистой БД (требует запущенного Postgres) |
| `S0-5-SEED` | `infra/postgres/migrations/045_scanner_config_seed.sql`: seed `scanner.defaults` + `scanner.instances` defaults (по образцу 032/035) | done | файл создан; применяется после 044 |
| `S0-6-REGISTRY` | `apps/web/lib/policy-config-registry.ts`: zod-схемы `scanner.defaults`, `scanner.instances` → появляются в `/settings` Extensions catalog | done | web build green, key виден в Extensions tab |

### Phase 1 — scanner-service core (apps/scanner-service, порт 3021)

| step_id | Суть | status | DoD |
|---------|------|--------|-----|
| `S1-1-SCAFFOLD` | NestJS+Fastify app skeleton: `main.ts` (port 3021, `installMetricsOnFastify` + `serviceName`), `app.module.ts`, package.json, tsconfig.build.json, nest-cli.json. Root scripts `dev:scanner`/`build:scanner`. `ARBIBOT_TYPEORM_ENTITIES` wired. | done | `npm run build -w @arbibot/scanner-service` green; `npm run dev:scanner` стартует, `GET /health` → 200 |
| `S1-2-CONFIG` | Config loader (mirror `paper-discovery.service.ts:255-289`): TTL-cache `scanner.*` из config-service, env fallback, `SCANNER_CONFIG_CACHE_TTL_MS` (30s), periodic reload. | done | unit test: cache TTL, env fallback, reload reconcile |
| `S1-3-WORKER` | Worker skeleton (mirror paper-discovery-worker): `OnModuleInit/OnModuleDestroy` + `setInterval(...).unref()` + `isRunning` guard + metrics `arb_scanner_*` с `registers:[getArbibotMetricsRegistry()]`. Per-instance timers. | done | unit test: start/stop, isRunning guard, metrics registered |
| `S1-4-RPC` | RPC layer (read-only): provider из `RPC_SCANNER_*_URL` (fallback `RPC_*_URL`), **rate limiter** (`SCANNER_RPC_RATE_LIMIT_RPS`, token bucket), health check. | done | unit test: rate limiter, fallback URL; `GET /health` показывает RPC статус |
| `S1-5-POOL` | Pool Reader: getReserves (V2), slot0+liquidity (V3), `pool.factory()` для protocol mapping. **Собственный `UNI_V3_POOL_SCANNER_ABI`** с `volumeToken0`/`volumeToken1`. **Factory mapping table** (uniswap-v2/sushiswap incl. Arbitrum 0xc35DADB65012eC5796536bD9864eD8773aBc74C4 — deployed-адрес, не plan-typo)/pancakeswap-v2/biswap). In-memory pool-кэш. | done | unit test: V2/V3 price parse, factory mapping, cache TTL; graceful revert на volumeToken для форков |
| `S1-6-VOLUME` | Volume Reader: V3 `volumeToken0/1` cumulative (mainnet-canonical, graceful revert) + V2 `eth_getLogs` short-window (1h bounded). **Swap topic0 compute via `ethers.id()`** (V2 sig: `Swap(address,uint256,uint256,uint256,uint256,address)`; V3 sig: `Swap(address,address,int256,int256,uint160,uint128,int24)`). Дефолт OFF. | done | unit test: V3 cumulative delta, V2 eth_getLogs bounded range, topic0 compute (не hardcode) |
| `S1-7-API` | HTTP API: `GET /scanner/instances` (config join runtime), `/instances/:id`, `/instances/:id/refresh-config` (force-refresh), `POST /instances/:id/run`, `/findings`, `/findings/:id`, `/status`, `/health`, `/metrics`. | done | manual smoke: все endpoints отвечают; metrics отдают `arb_scanner_*` |

### Phase 2 — Cross-DEX engine (same-chain 2-venue)

| step_id | Суть | status | DoD |
|---------|------|--------|-----|
| `S2-1-SPREAD` | Spread Detector: join per-venue prices (same canonical token, same chain) → spread bps. Net = gross − pool fees − gas estimate (БЕЗ slippage). | done | unit test: spread math, net profit, edge cases (zero spread, negative net) |
| `S2-2-FILTER` | Filter engine: per-instance filters из config (minSpreadBps, minLiquidityUsd, volumeRange{1h,24h,enabled}, blacklistTokens, allowedChains, quoteAssets). Переиспользует типы `dex-filters.types.ts`. | done | unit test: each filter, AND-combination, enabled toggle |
| `S2-3-DEDUP` | Dedup cooldown per `(canonical_token, buy_venue, sell_venue)` (configurable, default 60s). | done | unit test: cooldown window, bypass after expiry |
| `S2-4-INTEGRATE` | Pipeline wiring: per cycle → read pools → spread → volume → filter → dedup → WRITE findings+instances → (Phase 3) publish. | done | integration test: full cycle на whitelisted pools, findings written, instances updated |

### Phase 3 — Integration (→ opportunity-service)

| step_id | Суть | status | DoD |
|---------|------|--------|-----|
| `S3-1-PUBLISH` | Opportunity publisher: `POST /opportunities` с rich payload (заполняет spreadPct/profitUsd/feesUsd/volumeUsd/token/chain/quoteAsset/buyVenue/sellVenue/routeKey/instrumentKey). Save `opportunity_id` → `scanner_findings.opportunity_id`, `publish_status='published'`. | done | integration test: finding → POST /opportunities → opportunity_id saved |
| `S3-2-DEGRADE` | Graceful degradation: retry (3 attempts, exp backoff 1s/2s/4s) + `publish_status`/`publish_attempts` + **orphan retry worker** (max 5 cumulative, hourly) + metric `arb_scanner_opportunity_publish_failed_total` + `POST /scanner/findings/:id/re-publish`. | done | unit test: retry exhaustion → `failed`, orphan worker re-publishes, manual re-publish |
| `S3-3-PHASE3B` | **Phase 3b (модификация opportunity-service):** `create()` обернуть в `dataSource.transaction` + outbox `OpportunityDetected`. Primary образец `paperEnqueue()` (opportunities.service.ts:199-319). Envelope fields по чеклисту `scanner-service-plan.md` Phase 3b. | done | opportunity-service unit test: tx rollback, outbox written, envelope schema; regression: существующие create-тесты зелёные — 135/135 pass (включая 9 новых outbox-тестов); build + lint green |

### Phase 4 — Observability + Operator UI + Hermes

| step_id | Суть | status | DoD |
|---------|------|--------|-----|
| `S4-1-METRICS` | Все `arb_scanner_*` metrics (cycles, findings, spread_bps, volume_usd, rpc_latency, rpc_rate_limited, publish_failed, orphan_republish, pool_cache_hit_ratio, volume_revert). | done | `GET /metrics` отдаёт все метрики с labels — 184/184 tests pass (включая 14 новых metric-тестов); build + lint green. Новые: `opportunities_published_total{instance}`, `opportunity_publish_failed_total{instance,reason}` (reason: config/http_5xx/http_4xx/timeout/network/bad_response), `spread_bps{instance}` histogram, `volume_usd{instance,window}` histogram, `pool_cache_hit_ratio` gauge |
| `S4-2-BFF` | `apps/web/app/api/operator/scanners/`: instances, instances/[id], findings, findings/[id], status. `scanner` в `apps/web/lib/api-base.ts`. | done | BFF routes проксируют, session-check работает — 8 routes зарегистрированы в build (instances/findings GET, refresh-config/run/re-publish POST, status); `scanner-bff.ts` helper + `getOperatorSession()` + `x-operator-id`; build + lint green; `SCANNER_API_BASE` в `.env.example` |
| `S4-3-UI` | `/scanners` page: таблица инстансов (config join runtime), findings drilldown (→ opportunity link). nav link в `operator-nav.tsx`. `/settings`: `scanner.instances` editor. | done | frontend-review-agent pass; `/scanners` рендерится, drilldown работает — components (scanners-workspace + scanner-instances-table + scanner-findings-table), `scanner-types.ts`, query keys (`operatorKeys.scanner*`), React Query polling (status 5s, instances/findings 15s) + invalidation on mutations; nav link minRole:operator; `scanner.instances` уже виден в `/settings` Extensions catalog (struct editor — backlog enhancement); build + lint green (0 errors) |
| `S4-4-HERMES` | Hermes integration: gateway read-through (`GET /hermes/v1/scanner/findings`, `/status`, `/findings/:id`) + `SCANNER_API_BASE`; MCP tool `list_scanner_findings` (+ опц. get_scanner_status, get_top_findings); config-allowlist добавить `scanner.*`; skill `tools/hermes-agent/skills/scanner-status.md`. | done | hermes-agent-smoke CI pass; MCP tool отвечает; skill формат соответствует — 3 gateway endpoints + `getScannerApiBase()`; 2 MCP tools (list_scanner_findings, get_scanner_status) → 24 total; `scanner.*` в config-allowlist; skill `scanner-status.md`; build + lint + ci:hermes-agent-smoke pass (56 MCP tests) |

### Phase 5 — Config + Ops

| step_id | Суть | status | DoD |
|---------|------|--------|-----|
| `S5-1-SEED-SCRIPT` | `tools/seed-scanner-config.mjs` (по образцу `seed-intake-policy-config.mjs`). | done | `npm run seed:scanner-config` upsert’ит `scanner.*` через config-service — скрипт создан, mirror migration 045 values (`scanner.defaults` + `scanner.instances`), npm script добавлен, `node --check` green |
| `S5-2-RETENTION` | Retention cleanup worker (mirror worker skeleton): `DELETE FROM scanner_findings WHERE observed_at < now() - interval '<findingsRetentionDays> days'`, hourly. Metric `arb_scanner_findings_cleaned_total`. | done | unit test: cleanup deletes old rows, keeps recent; bounded — `ScannerRetentionWorkerService` (OnModuleInit/OnModuleDestroy + setInterval.unref + isRunning guard), env overrides (`SCANNER_FINDINGS_RETENTION_DAYS`, `SCANNER_RETENTION_INTERVAL_MS`, `SCANNER_RETENTION_ENABLED`), metric `arb_scanner_findings_cleaned_total{instance='global'}`; 9 unit tests pass (cutoff math, env/config override, 0-deleted no-incr, affected-missing defensive, error swallow, disable flag, destroy); build + lint green; wired в ScannerModule |
| `S5-3-PM2` | `ecosystem.config.cjs` entry для scanner-service (mirror существующих). Обновить `docs/paper-deploy-aeza.md` (14-й сервис). npm script `pm2:scanner`. | done | `pm2 start ecosystem.paper.config.cjs --only scanner-service` стартует; runbook обновлён — `scanner-harness-runbook.md` §6 дополнен готовым к вставке JS-блоком для `ecosystem.paper.config.cjs` (name/script/cwd/env PORT 3021/instances:1/autorestart), `node --check` green; `docs/paper-deploy-aeza.md` таблица сервисов дополнена scanner-service (3021). npm script `pm2:scanner` опционален — pm2 запускается через `--only` как остальные сервисы |
| `S5-4-CI` | CI: расширить `ci-paper-live-boundary.sh` (scanner ↔ paper симметрично) + `ci-scanner-smoke.sh` + `e2e-scanner-smoke.mjs` stub + GitHub Actions job `scanner-smoke`. | done | `npm run ci:scanner-smoke` pass в CI; paper-live-boundary расширен — PL.3 (scanner не импортирует paper) + PL.4 (paper не импортирует scanner); `ci-scanner-smoke.sh` (10 проверок: build, 13 providers, 8 routes, 11 metrics, 8 BFF routes, api-base, 3 gateway endpoints, getScannerApiBase, 2 MCP tools, PL.3/PL.4); `e2e-scanner-smoke.mjs` stub (health + metrics + read-only endpoints); npm scripts `ci:scanner-smoke` + `e2e:scanner-smoke`; GitHub Actions job `scanner-smoke` |
| `S5-5-DOCS` | Финальная документация: обновить `architecture-components.md` (новый сервис §1, single-writer таблицы, `scanner.*` config), `AGENTS.md` (env vars, scripts, ports), runbook `docs/scanner-runbook.md`. | done | architecture-guard-agent pass; все ссылки валидны — `architecture-components.md` обновлён (§1 table + §13 hermes scanner endpoints + §14a scanner-service full section + §14 web apiBases/pages/settings + §16 migrations 001-045 + §17 pipeline + §18 cross-DEX ✅); `AGENTS.md` (port 3021, `dev:scanner`/`build:scanner`/`seed:scanner-config`/`ci:scanner-smoke`/`e2e:scanner-smoke` scripts, `SCANNER_API_BASE`, CI job `scanner-smoke` #11); `docs/scanner-runbook.md` создан (8 секций: что делает, запуск, operations, observability, CI, deploy, troubleshooting, single-writer границы); architecture-guard-agent **APPROVE** |

---

## Dependency Graph

```
S0-0 → S0-1 ─┬─→ S0-2 ─→ S0-3 ─→ S0-4 ─→ S0-5 ─→ S0-6
             └──────────────────────────────────────┐
S1-1 ← (needs S0-1,S0-3) ─→ S1-2 ─→ S1-3 ─┬─→ S1-4 ─→ S1-5 ─→ S1-6 ─→ S1-7
                                          │
S2-1 ← (needs S1-5,S1-6) ─→ S2-2 ─→ S2-3 ─→ S2-4
S3-1 ← (needs S2-4) ─→ S3-2 ─→ S3-3 (Phase 3b, independent — needs S0-2 only)
S4-1 ← (needs S1-3) | S4-2 ← (needs S1-7) ─→ S4-3 (needs S4-2)
S4-4 ← (needs S1-7, S4-1)
S5-1 ← (needs S0-5) | S5-2 ← (needs S1-3) | S5-3 ← (needs S1-1) | S5-4 ← (needs S1-1,S4-1) | S5-5 (last)
```

**Критический путь:** S0-0 → S0-1 → S0-3 → S0-4 → S1-1 → S1-2 → S1-3 → S1-5 → S1-6 → S2-1 → S2-4 → S3-1.

**Phase 3b (S3-3) можно делать параллельно** — это модификация opportunity-service, зависит только от S0-2 (payload-схема).

---

## Workflow (как работать с планом)

1. **Прочитать индекс** (этот файл) — общая картина, статус фаз.
2. **Прочитать `scanner-service-plan.md`** (§3 детализация фазы) — архитектурный контекст шага.
3. **Прочитать `scanner-harness-runbook.md`** — как валидировать (build/lint/test/CI/e2e).
4. **Реализовать шаг**, обновить статус в этом файле (`todo` → `in_progress` → `done`).
5. **Пройти review-gate** (`review-gate-scanner.md` — чеклист по фазам) перед `done`.
6. **Commit** (git-workflow-agent: direct-to-main, scoped validation, structured commit linked to step_id).

## Проверка (DoD по фазам)

### Phase 0 DoD
- [ ] `npm run build` green (все пакеты incl. new contracts/persistence).
- [ ] `npm run db:migrate` на чистой БД применяет `<next>_scanner.sql` + seed.
- [ ] `npm run db:verify-migrations` на новых файлах проходит.
- [ ] ADR создан, `architecture-components.md` ссылается.

### Phase 1 DoD
- [ ] `npm run build -w @arbibot/scanner-service` green.
- [ ] `npm run lint -w @arbibot/scanner-service` 0 errors.
- [ ] `npm run dev:scanner` стартует, `GET /health` → 200, `GET /metrics` → `arb_scanner_*`.
- [ ] Unit tests: config loader, worker, RPC rate limiter, pool reader, volume reader.
- [ ] **Runtime check (как H5-G-RUNTIME):** реальный цикл с whitelisted pools на testnet/mainnet read-only — findings создаются, instances обновляются. Без этого — статических проверок недостаточно (урок `hermes-agent-dod-failure.md`).

### Phase 2 DoD
- [ ] Unit tests: spread math, filter engine (each filter), dedup cooldown.
- [ ] Integration test: full pipeline cycle на whitelisted pools.

### Phase 3 DoD
- [ ] Integration test: finding → POST /opportunities → opportunity persisted, id saved.
- [ ] Degradation: retry exhaustion → `failed`, orphan worker re-publishes, manual re-publish.
- [ ] Phase 3b: opportunity-service `create()` в tx + outbox; regression-тесты зелёные; envelope schema валидируется.

### Phase 4 DoD
- [ ] `npm run build -w @arbibot/web` green; `/scanners` рендерится.
- [ ] frontend-review-agent pass.
- [ ] Hermes: `ci:hermes-agent-smoke` pass; MCP tool `list_scanner_findings` отвечает.

### Phase 5 DoD
- [ ] `npm run ci:scanner-smoke` pass (CI harness).
- [ ] `npm run ci:paper-live-boundary` pass (расширен под scanner).
- [ ] PM2: `pm2 start ... --only scanner-service` стартует на Aéza-like окружении.
- [ ] `architecture-components.md` + `AGENTS.md` обновлены.
- [ ] architecture-guard-agent pass (новые single-writer границы).

## Что НЕ делаем (non-goals — из `scanner-service-plan.md` §6)

- Cross-chain bridge arb, triangular/cyclic arb (Phase 2+ стратегии).
- Автодрайв pipeline за пределами POST /opportunities.
- Factory-enumeration pool discovery.
- Live trading logic (сканер — data-provider).
- Дублирование EO price oracle / PoolDiscoveryService.
- Точный 24h V2 volume через full-range eth_getLogs.
- Fix `getMetrics()` mock в opportunity-service (не responsibility сканера).

## Связанные harness-документы

- [`docs/scanner-service-plan.md`](../../docs/scanner-service-plan.md) — архитектурный план (17 решений, 5 раундов ревью).
- [`docs/scanner-harness-runbook.md`](../../docs/scanner-harness-runbook.md) — CI/e2e/verify процессы.
- [`docs/review-gate-scanner.md`](../../docs/review-gate-scanner.md) — review-gate чеклист по фазам.

---
*v1.0 — 2026-07-24*
