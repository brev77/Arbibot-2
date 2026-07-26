# Paper auto-drive — policy keys (config-service)

Канон для операторского UI и `AutoDriveWorker` в paper-trading-service: один JSON-документ на ключ **`paper.auto_drive`** (scope по умолчанию **`global`**; при необходимости — environment/tenant через `GET .../effective`).

> Архитектурно: auto-drive затрагивает только paper-сущности (`PaperTrade`, `PaperPromotionCandidate`, `PaperCapitalReservation`) и не пишет в live-агрегаты. Promotion (queued → promoted) **остаётся за оператором** (paper→live gate, `paper-live-boundary.md`); автоматизируется только post-promotion chain: `promoted → draft → (opt-in) active → settled`. См. `docs/tz-autodrive-audit.md`.

## Ключ и scope

| Поле | Значение |
|------|----------|
| `configKey` | `paper.auto_drive` |
| Scope по умолчанию | `global` (`scope_type = global`, `scope_value` null) |
| Effective API | `GET /policy/configurations/paper.auto_drive/effective` (опционально `?environment=` и `?tenantId=`) |

Значение (`config_value`) — **строка JSON** (один объект), см. схему ниже.

## Схема JSON (`config_value`)

Все поля опциональны; неуказанные берутся из env (`PAPER_AUTO_DRIVE_*` / `PAPER_*`) или дефолтов в коде.

| Поле | Тип | Смысл |
|------|-----|--------|
| `enabled` | boolean | **Kill-switch**: включить/выключить весь auto-pipeline. **По умолчанию `false`** (safe-by-default) |
| `minNetProfitUsd` | number | Не создавать draft из кандидатов с `netProfitUsd` ниже порога (USD) |
| `maxConcurrentTrades` | number | Hard cap одновременно активных paper trades; фаза авто-approve пропускается при достижении cap |
| `notionalUsd` | number | Фиксированный объём (USD) для paper trade |

## Переменные окружения (paper-trading-service)

| Env | Default | Назначение |
|-----|---------|------------|
| `PAPER_AUTO_DRIVE_ENABLED` | `false` | Kill-switch (env override над `enabled` в config-service) |
| `PAPER_AUTO_DRIVE_INTERVAL_MS` | `5000` | Интервал тика AutoDriveWorker (мс), минимум 1000 |
| `PAPER_AUTO_APPROVE` | `false` | Opt-in авто-approve drafts → active (promotion всё равно за оператором) |
| `PAPER_AUTO_SETTLE_DELAY_MS` | `5000` | Минимальный возраст active trade перед auto-settle (мс) |
| `PAPER_AUTO_DRIVE_MIN_NET_PROFIT_USD` | `5` | Порог net profit (USD) для фильтрации кандидатов |
| `PAPER_AUTO_DRIVE_MAX_CONCURRENT_TRADES` | `20` | Cap активных paper trades |
| `PAPER_NOTIONAL_USD` | `1000` | Объём для paper trade |
| `PAPER_AUTO_DRIVE_BATCH_SIZE` | `10` | Размер батча за тик (по фазам), максимум 50 |
| `PAPER_AUTO_DRIVE_CONFIG_CACHE_MS` | `15000` | TTL кэша effective-конфига (мс), минимум 5000 |
| `CONFIG_SERVICE_URL` или `CONFIG_API_BASE` | — | Базовый URL config-service (без `/policy`) |
| `PAPER_AUTO_DRIVE_CONFIG_ENVIRONMENT` | — | Query `environment` для effective |
| `PAPER_AUTO_DRIVE_CONFIG_TENANT_ID` | — | Query `tenantId` для effective |

При недоступности HTTP или отсутствии ключа используется **fallback** на env-значения.

## Kill-switch / panic

`tools/panic-button.sh` (unified panic-stop) flips `PAPER_AUTO_DRIVE_ENABLED=false` вместе с остальными kill-switchами — единый операторский путь «panic → всё встало».

`tools/panic-recover.sh` **намеренно НЕ восстанавливает** `PAPER_AUTO_DRIVE_ENABLED` автоматически: после panic оператор должен явно включить auto-drive заново (через `/settings` или env) — recovery не должен авто-перезапускать автоматическую торговлю.

## Согласование с UI

Оператор может задать тот же документ в **`/settings`** под ключом `paper.auto_drive` (глобальный scope). После сохранения и сброса кэша воркер подхватывает значение на следующем тике (с учётом TTL).

## Метрики

`AutoDriveWorker` экспонирует (общий реестр `getArbibotMetricsRegistry()`):

| Метрика | Тип | Labels |
|---------|-----|--------|
| `arb_paper_auto_drive_cycles_total` | Counter | `status` (success/error/disabled) |
| `arb_paper_auto_drive_promoted_to_draft_total` | Counter | `outcome` (created/skipped_exists/skipped_min_profit/failed) |
| `arb_paper_auto_drive_approved_total` | Counter | `outcome` (approved/skipped_max_concurrent/failed) |
| `arb_paper_auto_drive_settled_total` | Counter | `outcome` (settled/skipped_delay/settle_already_settled/failed) |
| `arb_paper_auto_drive_profit_usd` | Histogram | — |
| `arb_paper_auto_drive_latency_ms` | Histogram | — |

## API (paper-trading-service)

| Method | Path | Назначение |
|--------|------|-----------|
| `POST` | `/paper/trades/:id/settle` | Settle active trade (записывает P/L) — используется AutoDriveWorker и оператором |
| `GET` | `/paper/trades/history?from=&to=&limit=` | Settled trades за период (по `settled_at DESC`) |
| `GET` | `/paper/trades/stats?from=&to=` | Агрегаты: total, wins, winRate, totalProfitUsd, avgProfitUsd, avgSpreadBps |

Operator UI BFF: `GET /api/operator/paper/trades/history`, `GET /api/operator/paper/trades/stats`.
