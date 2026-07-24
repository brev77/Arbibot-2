# План: независимый масштабируемый сервис cross-DEX сканеров (v4 — после раунда 5)

> **Статус:** план согласован (5 раундов ревью). К разработке не приступали.
> **Дата:** 2026-07-24 (v4: правки раунда 5 — Phase 3b образец, Swap topics, config TTL, PM2, retention, degradation).
> **Связанные документы:** [`docs/architecture-components.md`](architecture-components.md) (карта компонентов/границ — canonical reference), [`docs/aggregates.md`](aggregates.md) (single-writer границы), [`docs/adr-scanner-service.md`](adr-scanner-service.md) (TODO, Phase 0), [`.cursor/plans/DEVELOPMENT_PLAN*.md`](../.cursor/plans/) (образец step_ids).

---

## Deliverable

Этот документ — верхнеуровневый план разработки **scanner-service**. Наполняется итеративно: следующие шаги — детализация фаз, ADR, миграции, executable step_ids.

---

## 0. Контекст и зафиксированные решения

Сканер — **автономный детектор cross-DEX spreads**, поставщик рыночной информации. Запустили → ищет → публикует opportunities → STOP. Решение live/paper — в существующем pipeline (оператор/риск/execution). Сканер **режимонезависимый data-provider** (ни paper, ни live).

### 17 зафиксированных решений (7 развилок + 5 раундов корректировок)

| # | Решение | Источник |
|---|---|---|
| 1 | Источник цен: **On-chain RPC напрямую** (свой reader: getReserves V2, slot0+liquidity V3, factory mapping Sushi/UniV2/Pancake/Biswap) | развилка 1 |
| 2 | Модель: **Один сервис + DB-реестр инстансов** (параметризованный worker, по образцу paper-discovery-worker) | развилка 2 |
| 3 | Автономность: **Только детект** → `POST /opportunities` → STOP | развилка 3 |
| 4 | Режим: **Режимонезависимый data-provider** | развилка 4 |
| 5 | Volume: **On-chain** (V3 cumulative + V2 short-window eth_getLogs; дефолт OFF) | развилка 5 + корр. #3 раунда 2 |
| 6 | Стратегии MVP: **Same-chain 2-venue** | развилка 6 |
| 7 | Хранение: **scanner_instances (runtime-only) + scanner_findings (data)** | развилка 7 + корр. #5 раунда 2 |
| 8 | Конфиг: **Всё в config-service** (`scanner.*` — single-writer конфигурации инстансов incl. enabled; scanner_instances — runtime-only) | корр. #5 раунда 2 + ответ |
| 9 | `OpportunityDetected` outbox: **Phase 3b, делать сейчас** (payload-схема в events.ts + outbox в opportunity-service.create()) | корр. #1 раунда 2 + ответ |
| 10 | Volume ABI: **собственный `UNI_V3_POOL_SCANNER_ABI`** с volumeToken0/volumeToken1 (mainnet-canonical pools, graceful revert) | корр. #1 раунда 4 |
| 11 | Hermes: **Phase 4 sub-step** (gateway read-through + MCP tools + config allowlist + skill) | корр. #4 раунда 4 |
| 12 | Phase 3b образец: **primary `paperEnqueue()` (opportunities.service.ts:199-319)** — ближайший по структуре; `risk.service.ts`/`snapshots.service.ts` — secondary. dataSource уже injected (line 62), OutboxEventEntity уже imported (line 18). | корр. #1 раунда 5 |
| 13 | V2/V3 Swap events — **разные topic0, compute via `ethers.id()`** (не hardcode). V2 sig: `Swap(address,uint256,uint256,uint256,uint256,address)`; V3 sig: `Swap(address,address,int256,int256,uint160,uint128,int24)`. Pancake V3/Biswap V3 caveat. | корр. #2 раунда 5 |
| 14 | Config cache: **явный TTL `SCANNER_CONFIG_CACHE_TTL_MS` (30s default)** + **force-refresh endpoint `POST /scanner/instances/:id/refresh-config`**. Redis pub/sub invalidation — non-goal MVP. | корр. #3 раунда 5 |
| 15 | PM2: **ecosystem.config.cjs entry** для scanner-service + обновить `docs/paper-deploy-aeza.md` (14-й сервис в pm2 stack). | корр. #4 раунда 5 |
| 16 | scanner_findings **retention policy**: индекс на `observed_at` + cleanup worker (`scanner.defaults.findingsRetentionDays`, default 7). Partitioning — non-goal MVP. | корр. #5 раунда 5 |
| 17 | Graceful degradation: **retry (3 attempts, exp backoff)** + `publish_status` поле (`pending\|published\|failed`) + **orphan retry worker** + metric `arb_scanner_opportunity_publish_failed_total` + manual re-publish API. | корр. #6 раунда 5 |

---

## 1. Карта контуров — кто чем владеет (анти-дублирование)

> Главная задача плана — распределить ответственность, не дублировать функции существующих сервисов. Ссылки на single-writer границы — [`architecture-components.md`](architecture-components.md) §1.

### Конфигурация (single-writer = config-service)

- **`scanner.defaults`** (config key, global/env/tenant scope) — fallback фильтры, RPC budget defaults.
- **`scanner.instances`** (config key) — массив определений инстансов:
  ```json
  {
    "id": "arb-2venue-1",
    "name": "Arbitrum 2-venue",
    "network": "arbitrum",
    "strategy": "2venue",
    "interval_ms": 2000,
    "filters": {
      "minSpreadBps": 30,
      "minLiquidityUsd": 50000,
      "volumeRange": { "enabled": false, "min1hUsd": 0, "max24hUsd": 0 },
      "blacklistTokens": [],
      "allowedChains": [42161],
      "quoteAssets": ["WETH", "USDC"]
    },
    "poolWhitelist": ["0x...pool1", "0x...pool2"],
    "enabled": true
  }
  ```
  Operator управляет через `/settings` (audit, scopes, rollback — бесплатно из config-service) или через Hermes (Telegram, если allowlist добавлен — Phase 4).

### Runtime-статус (single-writer = scanner-service)

- **`scanner_instances`** (table) — runtime-only:
  ```
  instance_id (FK→config id), last_run_at, last_error, status[idle|running|error],
  cycles_total, findings_total, opportunities_published_total, last_cycle_latency_ms, updated_at
  ```
  **Без config-полей, без `enabled`.** Upsert each cycle. Для UI/Prometheus/Hermes.

### Data (single-writer = scanner-service)

- **`scanner_findings`** (table) — найденные cross-venue deals:
  ```
  id, instance_id, opportunity_id? (FK после POST /opportunities),
  publish_status (pending|published|failed),          ← корр. #6 раунда 5
  publish_attempts (int, default 0),                   ← корр. #6 раунда 5
  canonical_token, chain_id, buy_venue, sell_venue, buy_pool_addr, sell_pool_addr,
  spread_bps, gross_profit_usd, net_profit_usd, fees_usd,
  volume_1h_usd?, volume_24h_usd?, observed_at
  ```
  **Finding ≠ opportunity.** Finding — raw cross-venue факт; opportunity — то, что отправлено в opportunity-service.
  - `publish_status`: `pending` → создание/первая попытка; `published` (opportunity_id заполнен); `failed` (terminal после max retries).
  - **Retention** (корр. #5 раунда 5): индекс на `observed_at` + на `(instance_id, observed_at desc)`; cleanup worker удаляет старше `scanner.defaults.findingsRetentionDays` (default 7).
- In-memory pool-кэш (per venue × token, TTL).
- Prometheus metrics `arb_scanner_*`.

### Сканер ЧИТАЕТ (read-only, не владеет)

- **On-chain RPC** (Arb/Base/BNB) — свой read-only provider instance (без wallet/key). Свой env namespace `RPC_SCANNER_{CHAIN}_URL` для изоляции rate budget от execution-orchestrator. Fallback на shared `RPC_*_URL`.
- **config-service**: `scanner.*` ключи (TTL cache, mirror paper-discovery `ensureEffectiveConfigLoaded` `paper-discovery.service.ts:255-289`).
- **canonical-market-service**: `POST /market/resolve-instrument` — point-lookup канонических ID. ⚠️ Enumeration endpoint НЕТ (gap `architecture-components.md:619`) — pool universe задаётся whitelist в config.
- **risk-service** (опц. pre-filter): `GET /policy/token-profiles`, `GET /policy/route-profiles` — не слать deals по инструментам с notional cap ниже потенциальной сделки.

### Сканер ПЕРЕДАЁТ (outbound, через `signedFetch`)

- **`POST /opportunities`** (opportunity-service) с **богатым payload** — ЗАПОЛНЯЕТ поля, читаемые сегодня с `?? 0` (`opportunities.service.ts:363-370`): `spreadPct, profitUsd, feesUsd, volumeUsd, token, chain, quoteAsset, buyVenue, sellVenue, routeKey, instrumentKey, poolAddresses, riskLevel`. Возвращает `opportunity_id` → сохраняется в `scanner_findings.opportunity_id`.
- **`POST /audit/entries`** (audit-service) через `AuditClientService`.

### Сканер НЕ ДЕЛАЕТ (уважает чужие single-writer границы)

- НЕ пишет `market_snapshots`, `arbitrage_opportunities` (только через `POST /opportunities`), `risk_decisions`, `paper_*`, `execution_*`, `capital_*`.
- НЕ вызывает `POST /evaluate-risk` (opportunity-service/operator).
- НЕ дублирует execution-овый `PoolDiscoveryService` (тот address-keyed для execution; сканер enumeration для detection — разный use-case).
- НЕ пишет `enabled`/config инстансов (config-service owns).

---

## 2. Сквозной pipeline-контур

```
[On-chain RPC: Arbitrum / Base / BNB]  (RPC_SCANNER_*_URL — изолированный budget)
   │ getReserves (V2), slot0+liquidity (V3), pool.factory() (protocol mapping),
   │ volumeToken0/1 (V3 cumulative), eth_getLogs Swap (V2 short-window)
   ▼
┌─────────────────────────────────────────────────────┐
│ scanner-service (1 process, порт 3021)              │
│  reads config-service scanner.* (TTL cache)         │
│  ├─ instance#1 {net:arbitrum, strat:2venue, 2s, on} │  ← определение из config
│  ├─ instance#2 {net:base,     strat:2venue, 3s, on} │
│  rate limiter (token bucket, SCANNER_RPC_RATE_LIMIT)│  ← корр. #2 раунда 2
│  pool-cache (in-memory per venue × token, TTL)      │
│                                                      │
│ per cycle (per instance):                            │
│  1. read pools (RPC, rate-limited) → per-venue price │
│  2. cross-venue spread (same canonical token, ≥2     │
│     venues, same chain) → net = gross − fees − gas   │
│  3. read volume (V3 cumulative / V2 short-window)    │
│  4. apply filters (minSpreadBps, minLiquidity,       │
│     volumeRange if enabled, blacklist)               │
│  5. dedup (cooldown per token+venues pair)           │
│  6. WRITE scanner_findings + UPSERT scanner_instances│
│  7. POST /opportunities {rich payload}               │
│     └─ opportunity_id → findings.opportunity_id      │
└──────────────────────────────────────────────────────┘
   │ POST /opportunities (signedFetch)
   ▼
[opportunity-service] create() → arbitrage_opportunities (state=detected)
   + NEW Phase 3b: writes OpportunityDetected outbox (в transaction)
   ↓ STOP — сканер не драйвит дальше
   ↓ (оператор / существующая автоматика):
   enrich → request-risk-eval (risk-service → RiskDecisionIssued → relay → risk_checked)
   → ... → capital → execution
```

---

## 3. Фазы разработки

### Phase 0 — Contracts & Foundation (shared packages)

- **`packages/contracts/src/index.ts`**: добавить `scannerService: 'scanner-service'` в `SERVICE_IDS`; `SCANNER_HTTP_ROUTES` (list instances, get instance, list findings, trigger run, status, health).
- **`packages/contracts/src/events.ts`**: добавить **`OpportunityDetectedPayloadV1`** (rich: opportunityId, instrumentKey, routeKey, sourceModule='scanner-service', spreadBps, grossProfitUsd, netProfitUsd, feesUsd, volumeUsd, buyVenue, sellVenue, chainId, token, quoteAsset, evidence{}) + `OPPORTUNITY_DETECTED_PAYLOAD_SCHEMA_VERSION = 1`. Сегодня `opportunityDetected` в `EVENT_NAMES` (`events.ts:21`) — мёртвый код (нет схемы, нет продюсера).
- **`packages/persistence`**: `ScannerInstanceStatusEntity` (runtime-only, БЕЗ config-полей), `ScannerFindingEntity` + регистрация в `ARBIBOT_TYPEORM_ENTITIES`.
- **Миграция `<next-available>_scanner.sql`** (номер не фиксируется — корр. #3 раунда 4; последняя сегодня `043_bridge_finality.sql`) — `scanner_instances` (runtime status) + `scanner_findings` (incl. `publish_status`, `publish_attempts`) + индексы. Обязательные индексы (корр. #5 раунда 5):
  - `scanner_findings(observed_at)` — для retention cleanup.
  - `scanner_findings(instance_id, observed_at DESC)` — для UI-запросов «latest findings per instance».
  - `scanner_findings(publish_status) WHERE publish_status = 'pending'` — partial index для orphan retry worker.
  - `scanner_findings(opportunity_id)` — для drilldown opportunity → findings.
- **`apps/web/lib/policy-config-registry.ts`**: zod-схемы `scanner.defaults`, `scanner.instances` → появляются в `/settings` Extensions catalog.
- **Миграция seed `<next-available+1>_scanner_config_seed.sql`** (по образцу 032/035) — seed `scanner.*` defaults в `policy_configurations`.

### Phase 1 — scanner-service core (apps/scanner-service, порт 3021)

- NestJS+Fastify, `@arbibot/nest-platform` (signedFetch, metrics, audit, health).
- **Config loader** (mirror `paper-discovery.service.ts:255-289`): TTL-cache `scanner.*` из config-service, env fallback, periodic reload (reconcile timers on enable/disable/interval change).
  - **Явный TTL `SCANNER_CONFIG_CACHE_TTL_MS`** (default 30s, clamp 5s–300s) — корр. #3 раунда 5 (mirror `INTAKE_POLICY_CACHE_TTL_MS`).
  - **Force-refresh endpoint** `POST /scanner/instances/:id/refresh-config` — operator немедленно применяет config change без ожидания TTL. Audit-logged. UI hint: «config applied immediately (force-refresh) vs ~30s (TTL)».
  - Redis pub/sub invalidation — non-goal MVP (Phase 2+ enhancement).
- **Worker skeleton** (mirror `paper-discovery-worker.ts`): `OnModuleInit/OnModuleDestroy` + `setInterval(...).unref()` + `isRunning` guard + metrics `arb_scanner_*` с `registers:[getArbibotMetricsRegistry()]`. Per-instance timers (one interval per enabled instance).
- **RPC layer** (read-only):
  - Свой ethers provider из `RPC_SCANNER_{CHAIN}_URL` (fallback `RPC_*_URL`).
  - **Rate limiter** (token bucket, env `SCANNER_RPC_RATE_LIMIT_RPS`, default conservative) — корр. #2 раунда 2.
  - **Pool Reader**: getReserves (V2), slot0+liquidity (V3 — корректная цена, исправляет gap `pool-discovery.service.ts:236`), `pool.factory()` call для protocol mapping.
  - **Собственный ABI `UNI_V3_POOL_SCANNER_ABI`** (корр. #1 раунда 4): помимо token0/token1/fee/slot0/liquidity/factory включает `volumeToken0()`/`volumeToken1()`. Не модифицирует чужой ABI.
  - **Factory mapping table** (корр. #4 раунда 2): `factory address → {protocol, venueKey}` — uniswap-v2, sushiswap (включая Arbitrum `0xc35DADB65012eC4126586465b0d79A6a5A93026C`), pancakeswap-v2, biswap. Закрывает разрыв `architecture-components.md:221`.
  - In-memory pool-кэш (TTL, staggered refresh per instance).
- **Volume Reader** (корр. #1+#3 раунда 2/4 + #2 раунда 5):
  - **V3**: `volumeToken0()`/`volumeToken1()` cumulative (single-call, cached baseline) — **mainnet-canonical UniV3 pools only** (Arb/Base/BNB). ⚠️ **Graceful revert handling** (try/catch → volume=unknown → skip volume filter для этого пула) для форков/тестнетов без этих функций.
  - **V2**: `eth_getLogs` по `Swap` topic **только за short-window** (1h, bounded ~14,400 блоков на Arbitrum). V2 НЕ имеет cumulative volume (только reserves). 24h V2 = non-goal.
  - **Swap event topic0** (корр. #2 раунда 5) — V2 и V3 **разные signatures → разные topic0**. Topic0 = `ethers.id(eventSignature)` (вычисляется рантайм из ABI фрагмента, НЕ hardcode):
    - V2-family (UniV2/Sushi/PancakeV2/Biswap): event signature `Swap(address,uint256,uint256,uint256,uint256,address)`
    - V3-family: event signature `Swap(address,address,int256,int256,uint160,uint128,int24)`
    - ⚠️ Pancake V3 / Biswap V3 форки могут иметь модифицированный Swap event (extra fields) → другая signature → другой topic — проверить на детализации; MVP scope = canonical UniV2 + UniV3. Literal topic0 hex не приводится здесь умышленно (64-hex строки триггерят secret-scanning как ethereum-private-key; signature → `ethers.id()` — единственный источник правды).
  - **Дефолт OFF** (`filters.volumeRange.enabled=false`); volume filter opt-in.
- HTTP API: `GET /scanner/instances` (runtime status join с config), `GET /scanner/instances/:id`, `POST /scanner/instances/:id/refresh-config` (force-refresh — корр. #3 раунда 5), `POST /scanner/instances/:id/run` (manual trigger), `GET /scanner/findings`, `GET /scanner/findings/:id`, `POST /scanner/findings/:id/re-publish` (manual re-publish orphan — корр. #6 раунда 5), `GET /scanner/status`, `GET /health`, `GET /metrics`.

### Phase 2 — Cross-DEX engine (same-chain 2-venue)

- **Spread Detector**: join per-venue prices для одного canonical token (same chain) → spread bps. Net profit = gross − pool fees − gas estimate (`GasEstimatorService`-подобная оценка, БЕЗ slippage modelling — slippage в execution `SlippageProtectionService`).
- **Filter engine**: per-instance filters из config (`minSpreadBps, minLiquidityUsd, volumeRange{1h,24h,enabled}, blacklistTokens, allowedChains, quoteAssets`). Переиспользует типы `packages/contracts/src/dex-filters.types.ts` где уместно.
- **Pool universe**: configured whitelist (`poolWhitelist[]` в config инстанса) — детерминированно/быстро для MVP. Factory-enumeration (UniV2Factory.allPairs) — non-goal Phase 2+.
- **Dedup**: cooldown per `(canonical_token, buy_venue, sell_venue)` (configurable, default 60s) — не слать duplicate opportunity.

### Phase 3 — Integration (→ opportunity-service)

- **Opportunity publisher** (корр. #6 раунда 5 — graceful degradation):
  - `POST /opportunities` с rich payload (заполняет spreadPct/profitUsd/feesUsd/volumeUsd/token/chain/quoteAsset/buyVenue/sellVenue/routeKey/instrumentKey). Сохраняет `opportunity_id` → `scanner_findings.opportunity_id`, `publish_status='published'`.
  - **Retry**: 3 attempts с exponential backoff (1s, 2s, 4s) на `signedFetch` failure / 5xx. На success → `publish_status='published'`.
  - **On terminal failure** (все retry исчерпаны): finding сохраняется с `opportunity_id=NULL`, `publish_status='failed'`, `publish_attempts=3`. Сканер НЕ теряет finding, НЕ блокируется.
  - **Metric**: `arb_scanner_opportunity_publish_failed_total{instance,reason}` (reason: timeout, 5xx, network, max_retries).
  - **Orphan retry worker** (Phase 3 sub-step, mirror cleanup-worker pattern `OnModuleInit/OnModuleDestroy` + `setInterval`): periodic background job переотправляет findings с `publish_status='pending'` или `'failed'` (null opportunity_id), stale > N sec. Bounded retries (max 5 cumulative), после — `publish_status='failed'` (требует manual re-publish).
  - **Manual re-publish**: `POST /scanner/findings/:id/re-publish` (audit-logged) — operator может переотправить failed finding.
- **Phase 3b (корр. #1 раунда 2, детализация #2 раунда 4 + #1 раунда 5) — opportunity-service outbox enrichment** (отдельный шаг, модификация opportunity-service):
  - `OpportunitiesService.create()` (`opportunities.service.ts:67-76`): обернуть в `dataSource.transaction(async (em) => {...})`.
  - **Primary образец: `paperEnqueue()` (`opportunities.service.ts:199-319`)** — ближайший по структуре (тот же файл, тот же сервис). ✅ `dataSource` уже injected (constructor line 62), ✅ `OutboxEventEntity` уже imported (line 18) — **не добавлять новые импорты**. Mirror этой реализации (tx + outbox + envelope + idempotency key + error handling), не перескакивать в risk.service/snapshots.service.
  - **Secondary references** (кросс-сервисные, для проверки envelope-формата): `risk.service.ts:205-237` (RiskDecisionIssued), `snapshots.service.ts:286-307` (SnapshotUpdated).
  - Внутри tx: `em.save(ArbitrageOpportunityEntity, row)` + `em.save(OutboxEventEntity, outbox)`.
  - **Outbox envelope fields чеклист**: `message_id` (UUID), `correlation_id`, `entity_type='arbitrage_opportunity'`, `entity_id=opportunity.id`, `schema_version=OPPORTUNITY_DETECTED_PAYLOAD_SCHEMA_VERSION` (1, из Phase 0), `source_module=SERVICE_IDS.opportunityService`, `event_type=EVENT_NAMES.opportunityDetected`, `payload=OpportunityDetectedPayloadV1` (JSONB), `envelope` (полный EventEnvelope JSONB), `event_ts` (ISO).
  - ⚠️ Это улучшение **opportunity-service**, не сканера. Зона ответственности: контракт «opportunity создан» → полноценный async-event.
  - ⚠️ Драйв lifecycle `detected→risk_checked` через это событие НЕ происходит (требует `RiskDecisionIssued` от risk-service через `request-risk-evaluation` — отдельный flow, уже работает). Событие чисто для наблюдаемости/future-consumers.
  - Note: сегодня `create()` не в transaction → структурное изменение, требует unit-тестов на idempotency (если добавляется `idempotencyKey`) и rollback.
  - Контракт payload зафиксировать в ADR `docs/adr-scanner-service.md`.

### Phase 4 — Observability + Operator UI + Hermes

- **Prometheus Metrics**: `arb_scanner_cycles_total{instance,status}`, `arb_scanner_findings_total{instance,outcome}`, `arb_scanner_spread_bps{instance}` (histogram), `arb_scanner_volume_usd{instance,window}`, `arb_scanner_rpc_latency_ms{chain}`, `arb_scanner_rpc_rate_limited_total{chain}`, `arb_scanner_opportunities_published_total`, `arb_scanner_opportunity_publish_failed_total{instance,reason}` (корр. #6 раунда 5), `arb_scanner_pool_cache_hit_ratio`, `arb_scanner_volume_revert_total{protocol}` (V3 форки без volumeToken), `arb_scanner_orphan_republish_total{outcome}` (orphan worker).
- **BFF** (`apps/web/app/api/operator/scanners/`): `instances/route.ts`, `instances/[id]/route.ts`, `findings/route.ts`, `findings/[id]/route.ts`, `status/route.ts`. Добавить `scanner` в `apps/web/lib/api-base.ts`.
- **Web UI** `/scanners` page: таблица инстансов (config join runtime: enabled, status, last_run, findings count, last_error), drilldown findings (spread, volume, venues, → opportunity link). nav link в `operator-nav.tsx`.
- **Web UI** `/settings`: `scanner.instances` config editor (struct editor по образцу PaperDiscoveryPanel) — manage definitions/filters/enabled.
- **Hermes integration (корр. #4 раунда 4)** — sub-step:
  - Hermes Gateway (`apps/hermes-gateway/src/hermes/hermes.controller.ts`): read-through endpoints `GET /hermes/v1/scanner/findings` (latest N, filterable by instance/chain/venue), `GET /hermes/v1/scanner/status`, `GET /hermes/v1/scanner/findings/:id`. Upstream `SCANNER_API_BASE` в `apps/hermes-gateway/src/hermes/hermes-env.ts`.
  - MCP Server (`packages/hermes-mcp-server`): новый tool **`list_scanner_findings`** (args: `instanceId?, chainId?, limit?`) → Hermes Gateway → scanner-service. Доп. tools опц.: `get_scanner_status`, `get_top_findings` (by spread).
  - Hermes config mutation allowlist (`config-allowlist.ts`): добавить `scanner.*` → operator может менять конфиг инстансов через Telegram (mirror `/settings`).
  - Скилл `tools/hermes-agent/skills/scanner-status.md`: оператор спрашивает в Telegram «что нашёл сканер?» → agent вызывает MCP tool → человекочитаемая сводка.
- Dashboard summary widget (опц.): top active findings count.

### Phase 5 — Config + Ops

- Config keys (`scanner.defaults`, `scanner.instances`) — operator mutations через `/settings` или Hermes (config-service single-writer, audit, scopes, rollback). `scanner.defaults.findingsRetentionDays` (default 7, корр. #5 раунда 5).
- **Retention cleanup worker** (корр. #5 раунда 5, повышено до среднего — влияет на БД health): periodic background job (mirror `OnModuleInit/OnModuleDestroy` + `setInterval`, hourly): `DELETE FROM scanner_findings WHERE observed_at < now() - interval '<findingsRetentionDays> days'`. Метрика `arb_scanner_findings_cleaned_total`. При нагрузке MVP (2 chains × ~150 combinations × cycle 2s) таблица растёт на тысячи строк/час — без retention раздуется за неделю. Partitioning — non-goal MVP (рассмотреть Phase 2+ при volume росте).
- Seed-скрипт `tools/seed-scanner-config.mjs` (по образцу `seed-intake-policy-config.mjs`).
- npm scripts: `dev:scanner` (root package.json, по образцу — корр. #7 раунда 2), `build:scanner`. Docker compose dev-профиль `scanner-service` — только для prod-deploy, dev на хосте (корр. #9 раунда 2).
- **PM2 ecosystem config** (корр. #4 раунда 5): добавить entry для scanner-service в `ecosystem.config.cjs` (mirror существующих сервисов: name, script `dist/main.js`, cwd `apps/scanner-service`, env vars, instances:1, autorestart). Обновить `docs/paper-deploy-aeza.md` runbook (14-й сервис в pm2 stack). npm script `pm2:scanner` или документировать `pm2 start ecosystem.config.cjs --only scanner-service`.
- **CI**: расширить `ci-paper-live-boundary.sh` — scanner-service НЕ должен импортировать paper-модули и наоборот (симметрично). Добавить `e2e:scanner-smoke` job (по образцу `ci:e2e-phase3`).
- Документация: ADR `docs/adr-scanner-service.md`, runbook `docs/scanner-runbook.md`, обновить `architecture-components.md` (новый сервис в таблице §1, новые single-writer таблицы, `scanner.*` config).

---

## 4. Распределение ответственности (анти-дублирование — сводная таблица)

| Зона | Владелец | Сканер делает | Сканер НЕ делает |
|---|---|---|---|
| Scanner конфигурация (instances, filters, enabled) | **config-service** | читает (TTL cache) | не пишет enabled/конфиг |
| Market snapshots | market-intake | — | не пишет market_snapshots |
| Per-venue pool prices (detection) | **scanner (NEW)** | RPC read, in-memory cache | не дублирует execution PoolDiscovery |
| Pool prices (execution) | execution-orchestrator | — | не трогает |
| Cross-DEX spread detection | **scanner (NEW)** | compute, filter | — |
| Observed market volume (V3 cumulative / V2 short) | **scanner (NEW)** | RPC reads | не пишет dex_daily_volume (EO, executed notional) |
| Findings (raw cross-venue deals) | **scanner (NEW)** | пишет scanner_findings | не пишет arbitrage_opportunities напрямую |
| Opportunities (lifecycle) | opportunity-service | POST /opportunities | не пишет arbitrage_opportunities напрямую |
| OpportunityDetected event (outbox) | opportunity-service | — (только producer данных через POST) | Phase 3b правит opportunity-service, не сканер |
| Risk decisions | risk-service | — (read profiles опц.) | не вызывает /evaluate-risk |
| Capital / execution / paper | resp. сервисы | — | не трогает |
| Scanner runtime status | **scanner (NEW)** | upsert scanner_instances | не хранит config/enabled |

---

## 5. Ключевые допущения

1. **Pool universe** = configured whitelist (pool addresses per token × venue в config). Factory-enumeration — non-goal Phase 2+. Уточнить состав whitelist на детализации Phase 2.
2. **RPC rate budget** (корр. #2 раунда 2): изолированный env `RPC_SCANNER_{CHAIN}_URL` + клиентский rate limiter (`SCANNER_RPC_RATE_LIMIT_RPS`). Fallback на shared `RPC_*_URL` с conservative budget. Coordinator: сканер и execution-оркестратор бьют по разным endpoints в prod.
3. **Net profit** = gross − pool fees − gas estimate (БЕЗ slippage; slippage в execution `SlippageProtectionService`).
4. **Volume** (корр. #1+#3 раунда 2/4): V3 cumulative (mainnet-canonical, graceful revert) + V2 short-window eth_getLogs (1h bounded). 24h V2 через full-range eth_getLogs — non-goal. Дефолт volume filter OFF.
5. **signedFetch** (корр. #6 раунда 2): сканер читает `ARBIBOT_SERVICE_AUTH_SECRET`, `ARBIBOT_SERVICE_AUTH_ENABLED` из env (стандартное требование).
6. **enabled management** (корр. #5 раунда 2, ответ): всё в config-service (`scanner.instances[].enabled`). Pause/resume через `/settings` или Hermes (config mutation, audit, cache TTL задержка). scanner_instances — runtime-only, без enabled.
7. **Port**: 3021 (после hermes-gateway 3020).
8. **V3 volume ABI** (корр. #1 раунда 4): `volumeToken0`/`volumeToken1` работают только на канонических UniV3 pools Arb/Base/BNB; форки/тестнеты могут revert → graceful skip.
9. **Config cache TTL** (корр. #3 раунда 5): `SCANNER_CONFIG_CACHE_TTL_MS` (30s default). Disable/enable через `/settings` применяется либо немедленно (force-refresh), либо до TTL. Redis pub/sub invalidation — non-goal MVP.
10. **scanner_findings retention** (корр. #5 раунда 5): default 7 дней, configurable (`scanner.defaults.findingsRetentionDays`). Cleanup worker hourly. При нагрузке MVP таблица растёт быстро — retention обязателен.
11. **Degradation при opp-service down** (корр. #6 раунда 5): findings НЕ теряются — retry (3×, exp backoff) → `publish_status=failed` → orphan worker → manual re-publish. Сканер не блокируется.
12. **Swap event topics** (корр. #2 раунда 5): V2 и V3 — разные topic0; compute via `ethers.id()` из ABI фрагмента (не hardcode). Pancake V3/Biswap V3 форки могут отличаться — проверить на детализации.

---

## 6. Non-goals (вне scope первой итерации)

- Cross-chain bridge arb, triangular/cyclic arb (Phase 2+ стратегии).
- Автоматический драйв pipeline за пределами POST /opportunities.
- Factory-enumeration pool discovery (UniV2Factory.allPairs / V3 factory).
- Live trading logic (сканер — data-provider).
- Дублирование price oracle execution-оркестратора.
- Точный 24h V2 volume через full-range eth_getLogs (корр. #3 раунда 2).
- Fix `getMetrics()` mock в opportunity-service (корр. #8 раунда 2 — responsibility opp-service, не сканера; сканер заполняет payload, не чинит dashboard endpoints).

---

## 7. Лог корректировок (прозрачность, 4 раунда ревью)

### Раунд 2 (9 корректировок, все приняты)
- #1 create() outbox → Phase 3b, делать сейчас. Уточнено: НЕ драйвит lifecycle detected→risk_checked (требует RiskDecisionIssued).
- #2 RPC rate budget → свой env namespace + rate limiter (§5.2, Phase 1).
- #3 Volume → V3 cumulative + V2 short-window, дефолт OFF (§5.4, Phase 1).
- #4 Factory mapping → таблица в Phase 1.
- #5 Config vs DB → всё в config-service, scanner_instances runtime-only (§1, §5.6).
- #6 signedFetch secret → env vars (§5.5).
- #7 turbo.json → root package.json script (тривиально).
- #8 getMetrics mock → out-of-scope (§6).
- #9 Docker profiles → dev на хосте (Phase 5).

### Раунд 3 (2 развилки)
- enabled/paused → всё в config-service (§5.6).
- OpportunityDetected outbox → Phase 3b делать сейчас (§0 #9).

### Раунд 4 (4 корректировки, все приняты)
- #1 V3 volume ABI → собственный `UNI_V3_POOL_SCANNER_ABI` с volumeToken0/1 + graceful revert + mainnet-canonical-only (§0 #10, §5.8, Phase 1). Классифицировано high-priority для Volume Reader.
- #2 Phase 3b outbox → ссылки на образцы (`risk.service.ts:205-237`, `snapshots.service.ts:286-307`) + envelope fields чеклист (Phase 3b).
- #3 Migration numbering → `<next-available>` по всему плану (Phase 0).
- #4 Hermes MCP → Phase 4 sub-step «Hermes integration» (gateway read-through + MCP tools + config allowlist + skill).

### Раунд 5 (6 корректировок, все приняты)
- #1 Phase 3b образец → **primary `paperEnqueue()` (opportunities.service.ts:199-319)** вместо risk.service (ближайший по структуре, тот же файл/сервис). Note: dataSource уже injected (line 62), OutboxEventEntity уже imported (line 18) (Phase 3b, §0 #12).
- #2 V2/V3 Swap topics → оба topic0 явно + **compute via `ethers.id()` (не hardcode)** + V2/V3 signatures + Pancake V3/Biswap V3 caveat (Phase 1 Volume Reader, §0 #13, §5.12).
- #3 Config cache TTL → явный `SCANNER_CONFIG_CACHE_TTL_MS` (30s) + force-refresh endpoint `POST /scanner/instances/:id/refresh-config`. Redis pub/sub — non-goal (Phase 1 Config loader, §0 #14, §5.9).
- #4 PM2 → ecosystem.config.cjs entry + обновить paper-deploy-aeza.md (Phase 5, §0 #15).
- #5 scanner_findings retention → индексы (observed_at, instance_id+observed_at, publish_status partial, opportunity_id) + cleanup worker (`findingsRetentionDays` default 7, hourly). **Повышено с «низкое» до «среднее»** — влияет на БД health (Phase 0 миграция + Phase 5 worker, §0 #16, §5.10).
- #6 Graceful degradation → retry (3× exp backoff) + `publish_status`/`publish_attempts` поля + orphan retry worker + metric + manual re-publish API `POST /scanner/findings/:id/re-publish` (Phase 3, §0 #17, §5.11).

---

## 8. Следующие шаги (когда приступим к разработке)

1. Детализировать Phase 0 (contracts/entities/migration) → ADR `docs/adr-scanner-service.md`.
2. Уточнить допущения §5 (pool universe whitelist состав, RPC budget числовые значения).
3. Пофазно наполнять до executable шагов (step_ids по образцу `.cursor/plans/DEVELOPMENT_PLAN*.md`).
4. Запустить Phase 0 (contracts + миграции) — без runtime, можно валидировать build/lint/test.

---

## Приложение A — Env vars (сводка для Phase 1/5)

| Env | Назначение | Default |
|---|---|---|
| `PORT` | scanner-service HTTP | 3021 |
| `DATABASE_URL` | Postgres (общий со всеми сервисами) | — |
| `RPC_SCANNER_ARBITRUM_URL` / `RPC_SCANNER_BASE_URL` / `RPC_SCANNER_BNB_URL` | Изолированный RPC budget (fallback `RPC_*_URL`) | fallback shared |
| `RPC_SCANNER_{CHAIN}_BACKUP_URL` | FallbackProvider | — |
| `SCANNER_RPC_RATE_LIMIT_RPS` | Token bucket rate limit | conservative |
| `CONFIG_SERVICE_URL` / `CONFIG_API_BASE` | Чтение `scanner.*` | 3019 |
| `CANONICAL_MARKET_SERVICE_URL` | `POST /market/resolve-instrument` | 3014 |
| `RISK_SERVICE_URL` | (опц.) `GET /policy/token-profiles` pre-filter | 3000 |
| `OPPORTUNITY_SERVICE_URL` / `OPPORTUNITY_API_BASE` | `POST /opportunities` | 3010 |
| `ARBIBOT_SERVICE_AUTH_SECRET` / `ARBIBOT_SERVICE_AUTH_ENABLED` | signedFetch HMAC | required in prod |
| `SCANNER_POOL_CACHE_TTL_MS` | In-memory pool cache TTL | 30000 (5 min) |
| `SCANNER_CONFIG_CACHE_TTL_MS` | config-service `scanner.*` cache TTL (корр. #3 раунда 5) | 30000 (30s) |
| `SCANNER_FINDINGS_RETENTION_DAYS` | scanner_findings cleanup (override `scanner.defaults.findingsRetentionDays`, корр. #5 раунда 5) | 7 |
| `SCANNER_ORPHAN_RETRY_INTERVAL_MS` | Orphan publish retry worker interval (корр. #6 раунда 5) | 60000 (1 min) |
| `SCANNER_ORPHAN_MAX_ATTEMPTS` | Max cumulative publish attempts before `failed` (корр. #6 раунда 5) | 5 |
| `SCANNER_OPPORTUNITY_PUBLISH_TIMEOUT_MS` | signedFetch timeout to opportunity-service (корр. #6 раунда 5) | 5000 |
| `LOG_LEVEL`, `ARBIBOT_LOG_PRETTY` | pino logging | info |

## Приложение B — Существующий код для переиспользования (mirror patterns)

| Что | Образец | Путь |
|---|---|---|
| Worker skeleton | PaperDiscoveryWorker | `apps/paper-trading-service/src/paper-discovery/paper-discovery-worker.ts` |
| Config loader (TTL cache, env fallback) | ensureEffectiveConfigLoaded | `apps/paper-trading-service/src/paper-discovery/paper-discovery.service.ts:255-289` |
| Outbox transactional write | RiskDecisionIssued / SnapshotUpdated | `apps/risk-service/src/risk/risk.service.ts:205-237`, `apps/market-intake-service/src/snapshots/snapshots.service.ts:286-307` |
| Metrics (shared registry) | arb_paper_discovery_* | paper-discovery-worker.ts:28-60 |
| signedFetch (outbound HMAC) | — | `@arbibot/nest-platform` |
| Hermes read-through proxy | HermesController | `apps/hermes-gateway/src/hermes/hermes/hermes.controller.ts` |
| BFF proxy | health/dex | `apps/web/app/api/operator/health/dex/route.ts` |
| Config registry zod | policy-config-registry | `apps/web/lib/policy-config-registry.ts` |
| Config seed migration | 032/035 | `infra/postgres/migrations/` |
| Seed script | seed-intake-policy-config | `tools/seed-intake-policy-config.mjs` |
