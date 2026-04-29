# DEX Filters Configuration Keys

Документация конфигурационных ключей для системы фильтров возможностей DEX (шаг `DEX-1-0-FILTERS` в [`DEVELOPMENT_PLAN-DEX.md`](../.cursor/plans/DEVELOPMENT_PLAN-DEX.md)).

## Overview

Конфигурация фильтров хранится в **config-service** под ключом `dex.filters`. Каждый фильтр может быть включён или отключён через поле `enabled`. Конфигурация кэшируется в Redis (TTL 60s) для быстрого доступа воркером фильтрации.

## Config Key

- **Key:** `dex.filters`
- **Scope:** global / environment / tenant (поддержка CFG-3)
- **Type:** JSON object
- **Sensitive:** false (но изменения требуют operator approval)
- **Audit:** все изменения конфигурации логируются в audit-service

## Configuration Schema

```json
{
  "enabled": true,
  "filters": {
    "minSpreadPct": {
      "enabled": true,
      "value": 0.5
    },
    "minProfitUsd": {
      "enabled": true,
      "value": 10.0
    },
    "maxFeesUsd": {
      "enabled": true,
      "value": 5.0
    },
    "volumeRange": {
      "enabled": true,
      "min": 1000.0,
      "max": 100000.0
    },
    "blacklistTokens": {
      "enabled": true,
      "tokens": ["USDT", "USDC"]
    },
    "allowedChains": {
      "enabled": true,
      "chains": ["arbitrum", "base", "bnb"]
    },
    "quoteAssets": {
      "enabled": true,
      "assets": ["USDT", "USDC", "BTC", "ETH"]
    },
    "highRisk": {
      "enabled": true,
      "maxRiskLevel": "medium"
    }
  }
}
```

## Filters Reference

### 1. Минимальный спред (minSpreadPct)

**Тип:** Threshold filter  
**Поле:** `filters.minSpreadPct`  
**Описание:** Отклоняет возможности со спредом ниже указанного процента.

```json
{
  "enabled": true,
  "value": 0.5
}
```

- `enabled`: включить/выключить фильтр
- `value`: минимальный спред в процентах (например, 0.5 = 0.5%)
- **Validation:** value > 0
- **Default:** 0.5
- **Reason code:** `MIN_SPREAD_NOT_MET`

---

### 2. Минимальная прибыль (minProfitUsd)

**Тип:** Threshold filter  
**Поле:** `filters.minProfitUsd`  
**Описание:** Отклоняет возможности с прибылью ниже указанного значения в USD.

```json
{
  "enabled": true,
  "value": 10.0
}
```

- `enabled`: включить/выключить фильтр
- `value`: минимальная прибыль в USD
- **Validation:** value >= 0
- **Default:** 10.0
- **Reason code:** `MIN_PROFIT_NOT_MET`

---

### 3. Максимальная комиссия (maxFeesUsd)

**Тип:** Threshold filter  
**Поле:** `filters.maxFeesUsd`  
**Описание:** Отклоняет возможности с общими комиссиями выше указанного значения в USD.

```json
{
  "enabled": true,
  "value": 5.0
}
```

- `enabled`: включить/выключить фильтр
- `value**: максимальная сумма комиссий в USD
- **Validation:** value >= 0
- **Default:** 5.0
- **Reason code:** `MAX_FEES_EXCEEDED`

---

### 4. Объём (мин/макс) (volumeRange)

**Тип:** Range filter  
**Поле:** `filters.volumeRange`  
**Описание:** Отклоняет возможности с объёмом вне указанного диапазона в USD.

```json
{
  "enabled": true,
  "min": 1000.0,
  "max": 100000.0
}
```

- `enabled`: включить/выключить фильтр
- `min`: минимальный объём в USD
- `max`: максимальный объём в USD
- **Validation:** min >= 0, max > min
- **Default:** min=1000.0, max=100000.0
- **Reason code:** `VOLUME_OUT_OF_RANGE`

---

### 5. Чёрный список монет (blacklistTokens)

**Тип:** Blacklist filter  
**Поле:** `filters.blacklistTokens`  
**Описание:** Исключает возможности, содержащие указанные токены.

```json
{
  "enabled": true,
  "tokens": ["USDT", "USDC"]
}
```

- `enabled`: включить/выключить фильтр
- `tokens`: массив токенов (symbol или address) для исключения
- **Validation:** tokens — array of strings, min length 1
- **Default:** [] (пустой массив)
- **Reason code:** `TOKEN_BLACKLISTED`

---

### 6. Сети (allowedChains)

**Тип:** Whitelist filter  
**Поле:** `filters.allowedChains`  
**Описание:** Разрешает только указанные блокчейн-сети.

```json
{
  "enabled": true,
  "chains": ["arbitrum", "base", "bnb"]
}
```

- `enabled`: включить/выключить фильтр
- `chains`: массив поддерживаемых сетей (arbitrum, base, bnb)
- **Validation:** chains — array of strings, min length 1, валидные значения из ChainId enum
- **Default:** ["arbitrum", "base", "bnb"]
- **Reason code:** `CHAIN_NOT_ALLOWED`

---

### 7. Базовые монеты (quoteAssets)

**Тип:** Whitelist filter  
**Поле:** `filters.quoteAssets`  
**Описание:** Разрешает только указанные котировочные валюты.

```json
{
  "enabled": true,
  "assets": ["USDT", "USDC", "BTC", "ETH"]
}
```

- `enabled`: включить/выключить фильтр
- `assets`: массив котировочных валют (symbol или address)
- **Validation:** assets — array of strings, min length 1
- **Default:** ["USDT", "USDC", "BTC", "ETH"]
- **Reason code:** `QUOTE_ASSET_NOT_ALLOWED`

---

### 8. Высокий риск (highRisk)

**Тип:** Risk filter  
**Поле:** `filters.highRisk`  
**Описание:** Отклоняет возможности с уровнем риска выше указанного.

```json
{
  "enabled": true,
  "maxRiskLevel": "medium"
}
```

- `enabled`: включить/выключить фильтр
- `maxRiskLevel`: максимальный допустимый уровень риска (low, medium, high)
- **Validation:** maxRiskLevel ∈ ["low", "medium", "high"]
- **Default:** "medium"
- **Reason code:** `RISK_TOO_HIGH`

---

## Configuration Validation

### Валидация конфигурации

Конфигурация валидируется перед применением через `ConfigValidatorService`:

1. **Структурная валидация:** соответствие JSON schema
2. **Логическая валидация:**
   - `volumeRange.min` <= `volumeRange.max`
   - `minSpreadPct.value` > 0
   - `minProfitUsd.value` >= 0
   - `maxFeesUsd.value` >= 0
   - `maxRiskLevel` ∈ ["low", "medium", "high"]
   - `chains` — валидные ChainId
3. **Ограничения значений:**
   - `minSpreadPct.value` <= 10 (максимальный спред 10%)
   - `volumeRange.min` >= 100 (минимальный объём 100 USD)
   - `volumeRange.max` <= 1000000 (максимальный объём 1M USD)

При валидации конфигурации возвращается ошибка с деталями. Воркер фильтрации использует последнюю валидную конфигурацию.

---

## API Endpoints

### Get Effective Configuration

```http
GET /policy/configurations/dex.filters/effective
```

**Response:**
```json
{
  "configKey": "dex.filters",
  "value": {
    "enabled": true,
    "filters": { ... }
  },
  "scope": {
    "environment": "production",
    "tenantId": null
  },
  "version": 5,
  "createdAt": "2026-04-28T12:00:00Z",
  "operatorId": "operator-123"
}
```

### Update Configuration

```http
PUT /policy/configurations/dex.filters
Content-Type: application/json

{
  "enabled": true,
  "filters": { ... },
  "operatorId": "operator-123"
}
```

**Response:** 201 Created с новой конфигурацией

### Get Configuration History

```http
GET /policy/configurations/dex.filters/history?environment=production
```

**Response:** список версий конфигурации

### Validate Configuration (Preview)

```http
POST /policy/configurations/dex.filters/validate
Content-Type: application/json

{
  "enabled": true,
  "filters": { ... }
}
```

**Response:**
```json
{
  "valid": true,
  "errors": []
}
```

или

```json
{
  "valid": false,
  "errors": [
    "volumeRange.min (100000) must be <= volumeRange.max (50000)"
  ]
}
```

---

## Worker Integration

### Filters Worker

Воркер `filters.worker.ts` выполняет:

1. **Периодическая фильтрация:** каждые 30 секунд
2. **Загрузка конфигурации:** из config-service с кэшированием в Redis (TTL 60s)
3. **Применение фильтров:** ко всем активным возможностям
4. **Обновление статуса:** возможности, не прошедшие фильтры, помечаются `status: 'filtered'`
5. **Логирование:** детальная информация о применённых фильтрах

### Перефильтрация при изменении конфигурации

При изменении конфигурации:

1. Config-service публикует событие `ConfigurationUpdated` в Kafka
2. Воркер фильтрации подписывается на событие
3. При получении события — немедленная перефильтрация всех возможностей
4. Обновление `filters_applied` в таблице `arbitrage_opportunities`

---

## Metrics

### Prometheus Metrics

Каждый фильтр экспортирует метрики:

```prometheus
# Counter: количество возможностей, прошедших/отклонённых фильтром
arb_opportunity_filter_{filter_name}_total{status="passed|rejected"} 1234

# Gauge: текущая конфигурация фильтра
arb_opportunity_filter_{filter_name}_config_value{filter_name="minSpreadPct"} 0.5

# Histogram: время применения фильтра
arb_opportunity_filter_apply_seconds{filter_name="minSpreadPct"} 0.005
```

### Filter Metrics Names

- `arb_opportunity_filter_min_spread_pct_total`
- `arb_opportunity_filter_min_profit_usd_total`
- `arb_opportunity_filter_max_fees_usd_total`
- `arb_opportunity_filter_volume_range_total`
- `arb_opportunity_filter_blacklist_tokens_total`
- `arb_opportunity_filter_allowed_chains_total`
- `arb_opportunity_filter_quote_assets_total`
- `arb_opportunity_filter_high_risk_total`

---

## UI Integration

### Operator Dashboard

**Route:** `/opportunity/filters`

**Features:**

1. **Форма редактирования конфигурации** с превью валидации
2. **Toggle switches** для включения/отключения каждого фильтра
3. **Input validation** с мгновенными ошибками
4. **Preview impact** — показывает, сколько возможностей будет отклонено
5. **History view** — история изменений конфигурации
6. **Metrics panel** — распределение отклонённых возможностей по фильтрам
7. **Approval flow** — все изменения требуют operator approval

**BFF Endpoints:**

- `GET /api/operator/opportunity/filters` — текущая конфигурация
- `PUT /api/operator/opportunity/filters` — обновление конфигурации (с approval)
- `POST /api/operator/opportunity/filters/validate` — валидация конфигурации
- `GET /api/operator/opportunity/filters/history` — история изменений
- `GET /api/operator/opportunity/filters/preview` — превью влияния на возможности

---

## Rollback Procedure

Если новая конфигурация вызвала проблемы:

1. **Откатить конфигурацию:**
   ```bash
   # Получить предыдущую версию
   curl http://localhost:3019/policy/configurations/dex.filters/history | jq '.[1]'
   
   # Применить предыдущую версию
   curl -X PUT http://localhost:3019/policy/configurations/dex.filters/rollback \
     -H "Content-Type: application/json" \
     -d '{"version": 4, "operatorId": "operator-123", "reason": "Rollback due to issues"}'
   ```

2. **Остановить воркер фильтрации** (если необходимо):
   ```bash
   # Set feature flag
   DEX_FILTERS_ENABLED=false
   ```

3. **Перефильтровать вручную:**
   ```bash
   curl -X POST http://localhost:3010/opportunities/re-filter \
     -H "Content-Type: application/json" \
     -d '{"operatorId": "operator-123", "reason": "Manual re-filter after rollback"}'
   ```

4. **Проверить метрики:**
   ```bash
   curl http://localhost:3010/metrics | grep arb_opportunity_filter_
   ```

---

## Future Filters (CEX-specific)

Следующие фильтры **отложены** до реализации CEX интеграции:

- **Биржи (покупка/продажа)** — Белый список бирж для каждой стороны
- **Доступность перевода** — Проверка `withdrawal_open AND deposit_open AND network_match`
- **Хеджирование** — Флаг `futures_available = true`
- **Время перевода** — Порог `transfer_time <= max_transfer_time`
- **Направление** — Выбор: `DEX→CEX`, `CEX→DEX`, `CEX→CEX`, оба

Эти фильтры будут добавлены в конфигурацию в рамках Phase 2 (DEX-2) при интеграции с CEX.

---

## References

- [DEVELOPMENT_PLAN-DEX.md](../.cursor/plans/DEVELOPMENT_PLAN-DEX.md) — план разработки DEX
- [DEX-1-0-FILTERS step](../.cursor/plans/DEVELOPMENT_PLAN-DEX.md#dex-1-0-filters) — детальное описание шага
- [Config Service Documentation](./cfg-3-staged-rollout.md) — документация config-service
- [Policy Config Keys Catalog](./policy-config-keys-catalog.md) — каталог всех policy keys