# Scanner Service — Operator Runbook

> **Сервис:** `apps/scanner-service` (`@arbibot/scanner-service`), порт **3021**.
> **Роль:** автономный cross-DEX spread detector — **mode-agnostic data-provider** (ни paper, ни live). Запустили → ищет → публикует findings через `POST /opportunities` → STOP.
> **Архитектура:** [`docs/scanner-service-plan.md`](scanner-service-plan.md) (17 зафиксированных решений), [`docs/adr-scanner-service.md`](adr-scanner-service.md).
> **Single-writer границы:** [`docs/architecture-components.md`](architecture-components.md) §14a, §1.
> **Harness:** [`docs/scanner-harness-runbook.md`](scanner-harness-runbook.md) (CI/e2e/verify), [`docs/review-gate-scanner.md`](review-gate-scanner.md) (review-gate чеклист).

---

## 1. Что делает сканер

Сканер — единственный компонент системы, который **сравнивает цены одного инструмента между разными venue** на одной chain. Он:

1. Читает on-chain RPC (Arb/Base/BNB) — getReserves (V2), slot0+liquidity (V3), factory mapping (UniV2/Sushi/Pancake/Biswap).
2. Группирует пулы по canonical token pair → детектит cross-venue spread (spreadBps).
3. Применяет per-instance фильтры (minSpreadBps, minLiquidityUsd, volumeRange, blacklistTokens, allowedChains, quoteAssets).
4. Dedup по `(canonical_token, buy_venue, sell_venue)` (cooldown 60s default).
5. Пишет finding в `scanner_findings` (`publish_status=pending`).
6. POST `/opportunities` (rich payload) → opportunity-service (Phase 3b: пишет `arbitrage_opportunities` + `OpportunityDetected` outbox).
7. Сохраняет `opportunity_id` → `scanner_findings`, `publish_status=published`. **STOP** — сканер не драйвит lifecycle дальше (risk/capital/execution — существующий pipeline).

На failure (opportunity-service down): retry (3× exp backoff 1s/2s/4s) → `publish_status=failed` → orphan worker (hourly, max 5 cumulative) → manual re-publish через UI/API.

---

## 2. Запуск (dev)

### Локально (разработка)

```bash
# 1. Infra (Postgres + Redis)
docker compose -f infra/docker-compose.dev.yml up -d

# 2. Миграции (incl. 044_scanner.sql + 045_scanner_config_seed.sql)
npm run db:migrate

# 3. Seed config (если миграция 045 не применялась или нужно сбросить)
npm run seed:scanner-config

# 4. Scanner-service
npm run dev:scanner
# → http://127.0.0.1:3021/health
```

### Env vars (минимум для локального запуска)

| Env | Default | Назначение |
|-----|---------|-----------|
| `PORT` | 3021 | HTTP |
| `DATABASE_URL` | — | Postgres (общий со всеми сервисами) |
| `CONFIG_API_BASE` / `CONFIG_SERVICE_URL` | 3019 | Чтение `scanner.*` |
| `OPPORTUNITY_SERVICE_URL` | 3010 | `POST /opportunities` |
| `RPC_SCANNER_ARBITRUM_URL` / `_BASE_URL` / `_BNB_URL` | fallback `RPC_*_URL` | Изолированный read-only budget |
| `SCANNER_RPC_RATE_LIMIT_RPS` | 10 | Token bucket |

Полный список env vars — `scanner-service-plan.md` Приложение A + `architecture-components.md` §14a.

---

## 3. Operations

### Просмотр инстансов и findings

- **UI:** `/scanners` — таблица инстансов (config join runtime) + findings drilldown (→ `/opportunities/[id]`).
- **API (scanner-service):** `GET /scanner/instances`, `/findings`, `/status`.
- **Hermes (Telegram):** skill `scanner-status` → `list_scanner_findings` + `get_scanner_status` MCP tools.

### Управление конфигурацией

- **UI:** `/settings` → Extensions catalog → `scanner.instances` / `scanner.defaults` (JSON editor).
- **Hermes (Telegram):** `scanner.*` в config-allowlist — оператор может менять через config-management skill.
- **Force-refresh config cache:** `POST /scanner/instances/:id/refresh-config` (применяет `/settings` change сразу, без ожидания TTL 30s).

### Управление инстансами

- **Включить/выключить:** изменить `scanner.instances[].enabled` в config-service.
- **Manual cycle trigger:** `POST /scanner/instances/:id/run` (или кнопка "Run" в UI).
- **Re-publish failed finding:** `POST /scanner/findings/:id/re-publish` (или кнопка "Re-publish" в UI) — operator fallback когда orphan worker исчерпал max attempts.

### Retention

- `scanner_findings` cleanup worker (hourly) удаляет старше `scanner.defaults.findingsRetentionDays` (default 7).
- Metric: `arb_scanner_findings_cleaned_total{instance='global'}`.
- Override: `SCANNER_FINDINGS_RETENTION_DAYS`, `SCANNER_RETENTION_INTERVAL_MS`, `SCANNER_RETENTION_ENABLED=false`.

---

## 4. Observability

### Metrics (`GET /metrics`)

Все метрики на shared registry (`getArbibotMetricsRegistry()`), экспонируются через `installMetricsOnFastify`:

| Metric | Type | Labels | Назначение |
|--------|------|--------|-----------|
| `arb_scanner_cycles_total` | counter | instance, status | Циклы детекции (success/error/skipped) |
| `arb_scanner_spread_bps` | histogram | instance | Распределение spread (для tuning minSpreadBps) |
| `arb_scanner_volume_usd` | histogram | instance, window | Объём (для volume filter tuning) |
| `arb_scanner_opportunities_published_total` | counter | instance | Успешные публикации |
| `arb_scanner_opportunity_publish_failed_total` | counter | instance, reason | Неудачи (config/http_5xx/http_4xx/timeout/network/bad_response) |
| `arb_scanner_orphan_republish_total` | counter | status | Orphan worker (success/failed/exhausted) |
| `arb_scanner_rpc_latency_ms` | histogram | chain | RPC latency |
| `arb_scanner_rpc_rate_limited_total` | counter | chain | Token bucket denials |
| `arb_scanner_pool_cache_hit_ratio` | gauge | chain_id | hits/(hits+misses) |
| `arb_scanner_volume_revert_total` | counter | chain_id | V3 volumeToken0/1 reverts (forks/testnets) |
| `arb_scanner_findings_cleaned_total` | counter | instance | Retention cleanup |

### Health

- `GET /health` — basic Nest health.
- `GET /scanner/status` — worker runtime (isShuttingDown, scheduled/running instance ids).

---

## 5. CI / Verification

| Что | Команда | Покрытие |
|-----|---------|---------|
| Static wiring smoke | `npm run ci:scanner-smoke` | 10 проверок: build, providers, routes, metrics, BFF, gateway, MCP, boundary. **CI gate** (GitHub Actions job `scanner-smoke`). |
| Paper/live boundary | `npm run ci:paper-live-boundary` | PL.1-PL.4 (incl. scanner↔paper симметрия PL.3/PL.4). **CI gate**. |
| Runtime HTTP smoke | `npm run e2e:scanner-smoke` | health + metrics + read-only endpoints (требует запущенный scanner-service). |
| Seed config | `npm run seed:scanner-config` | HTTP upsert `scanner.*` через config-service. |
| Unit tests | `npm run test -w @arbibot/scanner-service` | 193 тестов (16 suites). |

**Manual runtime DoD** (не в CI, требует RPC/secrets): `scanner-harness-runbook.md` §3 — реальный RPC → finding → POST /opportunities round-trip на whitelisted pools.

---

## 6. Deploy (paper, Aéza-like)

См. [`docs/scanner-harness-runbook.md`](scanner-harness-runbook.md) §6 + [`docs/paper-deploy-aeza.md`](paper-deploy-aeza.md):

```bash
# На сервере
npm run build -w @arbibot/scanner-service
pm2 start ecosystem.paper.config.cjs --only scanner-service
pm2 save  # чтобы pm2 startup подобрал при ребуте

# Verify
curl -s http://127.0.0.1:3021/health | jq .
pm2 logs scanner-service --lines 20
```

Готовый блок для `ecosystem.paper.config.cjs` — `scanner-harness-runbook.md` §6 (name/script/cwd/env PORT 3021/instances:1/autorestart).

---

## 7. Troubleshooting

| Симптом | Причина | Действие |
|---------|---------|---------|
| `arb_scanner_opportunity_publish_failed_total{reason='config'}` растёт | `OPPORTUNITY_SERVICE_URL` не задан | Проверить env, restart scanner-service |
| `arb_scanner_opportunity_publish_failed_total{reason='http_5xx'}` | opportunity-service down / 5xx | Проверить `pm2 logs opportunity-service` |
| Findings не появляются | Instance disabled в config ИЛИ filters слишком жёсткие ИЛИ RPC rate-limited | `/scanners` UI → runtime status; `/settings` → filters; `arb_scanner_rpc_rate_limited_total` |
| `arb_scanner_volume_revert_total` растёт | V3 pool без volumeToken0/1 (fork/testnet) | Ожидаемо для форков; volume filter должен быть OFF для таких пулов |
| `arb_scanner_orphan_republish_total{status='exhausted'}` | Findings застряли в failed после 5 attempts | Manual re-publish через UI (`/scanners`) или `POST /scanner/findings/:id/re-publish` |
| `scanner_findings` растёт без очистки | Retention worker disabled | Проверить `SCANNER_RETENTION_ENABLED`; `arb_scanner_findings_cleaned_total` metric |

---

## 8. Single-writer границы (что сканер НЕ делает)

- **НЕ пишет** `arbitrage_opportunities` напрямую — только через `POST /opportunities` (opportunity-service single-writer).
- **НЕ пишет** `risk_decisions`, `paper_*`, `execution_*`, `capital_*`, `market_snapshots`.
- **НЕ вызывает** `POST /evaluate-risk` (это existing pipeline: operator / auto-enricher).
- **НЕ дублирует** execution-овый `PoolDiscoveryService` (тот address-keyed для execution; сканер — enumeration для detection, разный use-case).
- **НЕ пишет** `enabled`/config инстансов (config-service owns).
- **НЕ дублирует** `dex_daily_volume` (EO — executed notional; сканер — observed market volume, отдельная метрика).

Integration point: HTTP (`POST /opportunities`) + `@arbibot/contracts` (`OpportunityDetectedPayloadV1`). CI-гарантия: `ci-paper-live-boundary.sh` PL.3/PL.4.

---

## Связанные документы

- [`docs/scanner-service-plan.md`](scanner-service-plan.md) — архитектурный план (17 решений, 5 раундов ревью).
- [`docs/adr-scanner-service.md`](adr-scanner-service.md) — ADR (контекст, границы, payload-контракт).
- [`docs/scanner-harness-runbook.md`](scanner-harness-runbook.md) — CI/e2e/verify/deploy процессы.
- [`docs/review-gate-scanner.md`](review-gate-scanner.md) — review-gate чеклист по фазам.
- [`docs/architecture-components.md`](architecture-components.md) §14a — карта компонента + single-writer таблицы.
- [`.cursor/plans/DEVELOPMENT_PLAN-SCANNER.md`](../.cursor/plans/DEVELOPMENT_PLAN-SCANNER.md) — 24 step_ids (Phase 0-5, все done).

---

*v1.0 — 2026-07-25 (Phase 0-5 complete)*
