# Paper discovery — policy keys (config-service)

Канон для операторского UI и воркера paper discovery: один JSON-документ на ключ **`paper.discovery`** (scope по умолчанию **`global`**; при необходимости — environment/tenant через `GET .../effective` и query-параметры).

## Ключ и scope

| Поле | Значение |
|------|----------|
| `configKey` | `paper.discovery` |
| Scope по умолчанию | `global` (`scope_type = global`, `scope_value` null) |
| Effective API | `GET /policy/configurations/paper.discovery/effective` (опционально `?environment=` и `?tenantId=`) |

Значение (`config_value`) — **строка JSON** (один объект), см. схему ниже.

## Схема JSON (`config_value`)

Все поля опциональны; неуказанные берутся из env (`PAPER_DISCOVERY_*`) или дефолтов в коде.

| Поле | Тип | Смысл |
|------|-----|--------|
| `enabled` | boolean | Включить/выключить воркер |
| `intervalMs` | number | Интервал цикла (мс), минимум 5000 |
| `minProfitUsd` | number | Порог прибыли (USD) |
| `minLiquidityScore` | number | 0…1 |
| `maxCandidatesPerRun` | number | Лимит кандидатов за цикл |
| `paperOnlyTokens` | string[] | Токены paper-only (например `["BTC","ETH"]`) |
| `paperOnlyRoutes` | string[] | Маршруты (например `["btc-eth-a"]`) |

Фильтры token/route строятся как **декартово произведение** списков (как при `PAPER_DISCOVERY_PAPER_ONLY_TOKENS` / `ROUTES` в env).

## Переменные окружения (paper-trading-service)

| Env | Назначение |
|-----|------------|
| `CONFIG_SERVICE_URL` или `CONFIG_API_BASE` | Базовый URL config-service (без `/policy`) |
| `PAPER_DISCOVERY_CONFIG_CACHE_MS` | TTL кэша effective-конфига (мс), по умолчанию `15000` |
| `PAPER_DISCOVERY_CONFIG_ENVIRONMENT` | Query `environment` для effective |
| `PAPER_DISCOVERY_CONFIG_TENANT_ID` | Query `tenantId` для effective |

При недоступности HTTP или отсутствии ключа используется **fallback** на `PAPER_DISCOVERY_*` из `.env.example`.

## Согласование с UI

Оператор может задать тот же документ в **`/settings`** под ключом `paper.discovery` (глобальный scope). После сохранения и сброса кэша воркер подхватывает значение на следующем цикле (с учётом TTL).
