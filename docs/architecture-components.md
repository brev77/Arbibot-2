# Arbibot 2 — Карта компонентов, границ и настроек

> **Документ:** исчерпывающий обзор кодовой базы Arbibot-2, составленный прямым чтением исходников (не выдержками агентов).
> **Дата:** 23 июля 2026 г.
> **Цель:** единый справочник «что каждый компонент делает, какими таблицами/ключами владеет (single-writer границы), какие настройки читает». Предназначен для проектирования новых функций без предложений «как нового» того, что уже есть.

---

## 0. Как читать этот документ

Каждый компонент описан по одной схеме:
- **Назначение** — что делает (1–2 предложения).
- **Single-writer (чем владеет)** — таблицы/сущности, которые **только этот сервис** пишет. Это инвариант: никто другой не пишет в них напрямую.
- **Читает (read-only у других)** — чужие таблицы/конфиги.
- **HTTP API** — endpoints (метод + путь + кратко).
- **Ключевые сервисы/файлы** — `путь:строка`.
- **Настройки** — env-переменные + config-service ключи, которые компонент читает, с приоритетом (env → config → default).
- **События (outbox)** — что публикует в `outbox_events`.
- **Outbound HTTP** — какие другие сервисы вызывает.

Все утверждения о коде даны со ссылками `файл:строка` для проверки.

---

## 1. Карта сервисов (apps/*)

| Сервис | Порт | Single-writer таблицы | Роль в pipeline |
|---|---|---|---|
| risk-service | 3000 | `risk_decisions`, `risk_window_reservations`, `token_profiles`, `route_profiles`, `watchlist_tier_snapshots`, `route_scoring_history` | Риск-гейт: оценивает notional/time, policy writers |
| opportunity-service | 3010 | `arbitrage_opportunities` (+ `outbox_events` для PaperPromotion) | Lifecycle opportunities, relay в paper |
| capital-service | 3011 | `capital_reservations` (+ outbox CapitalReserved) | Резервирование капитала, capital ceiling |
| execution-orchestrator | 3012 | `execution_plans`, `execution_legs`, `on_chain_transactions`, `wallet_states`, `dex_daily_volume`, `bridge_transfers`, `dex_pools`, `approvals` (+ outbox PlanArmed/LegFilled/PlanCompleted/DexTransaction*) | Исполнение: arm, multi-leg, DEX swaps, bridges |
| audit-service | 3013 | `audit_log` (ед. ч.) | Журнал действий (append-only) |
| canonical-market-service | 3014 | `venue_refs`, `canonical_instruments`, `canonical_routes` | Identity resolver (venue/symbol/route) |
| market-intake-service | 3015 | `market_snapshots`, `market_snapshot_ingest_idempotency` (+ outbox SnapshotUpdated) | Ingest рыночных snapshots + throttling |
| portfolio-service | 3016 | `portfolio_positions`, `portfolio_position_*_idempotency` | Позиции (settlement) |
| reconciliation-service | 3017 | `reconciliation_mismatches`, `alertmanager_incidents` | Детекторы рассинхрона + alertmanager webhook |
| paper-trading-service | 3018 | `paper_trades`, `paper_promotion_candidates`, `paper_drift_samples`, `paper_capital_reservations`, `paper_discovery_candidates` | Paper-режим: сделки, promotion, drift, discovery |
| config-service | 3019 | `policy_configurations` | Single-writer конфигов, CRUD + scope/rollback/promote |
| hermes-gateway | 3020 | — (stateless proxy) | API-gateway для Hermes Agent (GLM/Telegram), прокси + mutations |
| scanner-service | 3021 | `scanner_instances` (runtime-only), `scanner_findings` | Cross-DEX spread detector → POST /opportunities (mode-agnostic data-provider) |

`apps/web` — Next.js operator UI (порт 3000 Next default), BFF прокси к сервисам выше.

---

## 2. risk-service

**Назначение:** single-writer риск-решений. Оценивает каждый trade по notional/time/profile-капам. Также владеет policy writers (watchlist tiering, route scoring).

### Single-writer (владение)
- `risk_decisions` — `RiskService.evaluateRisk` (`apps/risk-service/src/risk/risk.service.ts:187-203`).
- `risk_window_reservations` — `reserveRiskWindow` (`:68-79`).
- `token_profiles` / `route_profiles` — заполнение (seed) ручное/через writers; **read-only** в `TokenProfileService` (`policy/token-profile.service.ts:24-36` — «mutations remain future scope»).
- `watchlist_tier_snapshots` — `WatchlistTieringWriterService.runCycle` (`policy/watchlist-tiering-writer.service.ts:63-86`).
- `route_scoring_history` — `RouteScoringWriterService.runCycle` (`policy/route-scoring-writer.service.ts:74-124`).

### Читает (read-only)
- `route_profiles.max_notional_usd` для капов в `evaluateRisk` (`risk.service.ts:274-303`).
- config-service `capital.*`? Нет — только токен/роут профили из своей же БД.

### HTTP API (`apps/risk-service/src/risk/risk.controller.ts`)
- `POST /evaluate-risk` — основная точка. Тело: `EvaluateRiskRequestDto` (`risk/dto/evaluate-risk-request.dto.ts`): `correlationId, planReference, notionalUsd, snapshotVersion, riskMode?, idempotencyKey?, riskWindowReservationId?, instrumentKey?, routeKey?, adaptiveRisk?`.
- `POST /reserve-risk-window`.
- `GET /risk-decisions/:id`.
- `GET /policy/phase2-readiness`, `GET /policy/token-profiles`, `GET /policy/route-profiles`, `GET /policy/watchlist/tiers`, `GET /policy/route-scoring-history/:routeKey` (`policy/policy.controller.ts`).
- `POST /policy/jobs/watchlist-tiering`, `POST /policy/jobs/route-scoring` — token-gated через `x-arbibot-job-trigger` + `RISK_POLICY_JOB_TRIGGER_TOKEN` (`policy/policy-jobs.controller.ts:11-23`).

### Логика policy (`risk/risk.policy.ts:30-71`)
- `evaluateRiskPolicy`: conservative режим → `deferred` вне UTC окна [08:00, 20:00]; иначе `notionalUsd > min(modeThreshold, profileCap)` → `rejected`.
- Пороги по режимам: `fast: 5_000_000`, `standard: 1_000_000`, `conservative: 250_000` (`:5-9`).
- Adaptive risk: `AdaptiveRiskService.multiplierFor` (`policy/adaptive-risk.service.ts:18-30`) — UTC peak [12,20] × mode → multiplier (0.75–1.0) применяется к profileCap только при `adaptiveRisk=true`.

### Настройки (env)
- `RISK_POLICY_JOB_TRIGGER_TOKEN` — для запуска jobs.
- `ROUTE_SCORING_LOOKBACK_HOURS` (24), `ROUTE_SCORING_NOTIONAL_REF_USD` (5M).
- `WATCHLIST_TIER_HOT_MIN_USD` (1M), `WATCHLIST_TIER_WARM_MIN_USD` (100K).

### События (outbox)
- `RiskDecisionIssued` (v1) — публикуется в `evaluateRisk` (`risk.service.ts:205-237`).

### Outbound HTTP
- `AuditClientService.appendEntry` (через `@arbibot/nest-platform`, HTTP к audit-service).

---

## 3. opportunity-service

**Назначение:** single-writer `arbitrage_opportunities` + lifecycle (detected → enriched → risk_checked). Relay в paper-trading.

### Single-writer
- `arbitrage_opportunities` — `OpportunitiesService.create` (`apps/opportunity-service/src/opportunities/opportunities.service.ts:67-76`). `create()` тривиальный: `state='detected'`, `payload=dto.payload ?? {}`, **не пишет outbox**.
- `outbox_events` (только `PaperPromotionCandidateRequested`) — `paperEnqueue` (`:286-317`).

### Читает
- `risk_decisions` — нет, через HTTP к risk-service.
- config `dex.filters`? **Нет** — `previewFilters()` получает `filters` как параметр от HTTP-вызывающего (`:334-336`).

### HTTP API (`opportunities/opportunities.controller.ts`)
- `POST /opportunities` — `CreateOpportunityDto` = `{correlationId?, payload?}` (object). `forbidNonWhitelisted: true` → только эти 2 top-level поля.
- `POST /opportunities/:id/enrich`, `POST /opportunities/:id/paper-enqueue`, `POST /opportunities/:id/request-risk-evaluation`.
- `POST /opportunities/paper-discovery/run` — token-gated (`PAPER_DISCOVERY_RUN_TOKEN`).
- `GET /opportunities`, `GET /opportunities/:id`.
- `POST /opportunities/preview-filters`, `GET /opportunities/metrics/dex-filters` (**mock** — `:458`).

### Что известно про payload (читается в `previewFilters:363-370`)
Поля, которые `previewFilters` читает из `payload`: `spreadPct, profitUsd, feesUsd, volumeUsd, token, chain, quoteAsset, riskLevel`. **Сегодня ни один producer их не заполняет** — все `?? 0`. `paper-discovery.service.ts:53-63` пишет только `{instrumentKey, source:'paper_discovery', tokenKey}`.

### События (outbox)
- `PaperPromotionCandidateRequested` (v1) — в `paperEnqueue`.

### Outbound HTTP (`signedFetch`)
- `RiskClientService.evaluateRisk` → `POST ${RISK_SERVICE_URL}/evaluate-risk` (`opportunities/risk-client.service.ts:56-68`).
- `PaperClientService.enqueuePromotionCandidate` → `POST ${PAPER_TRADING_SERVICE_URL}/paper/promotion-candidates` (`opportunities/paper-client.service.ts:32-59`).

### Outbox Relay (`outbox-relay.service.ts`)
- `OutboxRelayService` крутит `setInterval` (`OUTBOX_RELAY_POLL_MS`, по умолч. 2000), `OUTBOX_RELAY_BATCH` (25).
- Relay-типы: `RiskDecisionIssued` (INBOUND — из risk outbox в inbox, обновляет opportunity → `risk_checked`) и `PaperPromotionCandidateRequested` (OUTBOUND — HTTP к paper-service).
- Idempotency через `tryClaimInboxMessage` (consumer_id=`opportunity-service`).

### Настройки (env)
- `RISK_SERVICE_URL` (http://127.0.0.1:3000), `PAPER_TRADING_SERVICE_URL` (если не задан — paper client disabled).
- `OUTBOX_RELAY_ENABLED`, `OUTBOX_RELAY_POLL_MS`, `OUTBOX_RELAY_BATCH`, `OUTBOX_RELAY_MAX_PAPER_PROMOTION_ATTEMPTS` (25), `OUTBOX_RELAY_MAX_OPPORTUNITY_ATTEMPTS` (25).
- `PAPER_DISCOVERY_INSTRUMENT_KEYS` (по умолч. `BTC,ETH` — для локального paper-discovery в opportunity-service; это **не** cross-DEX сканер).

---

## 4. capital-service

**Назначение:** single-writer `capital_reservations` + aggregate capital ceiling (D4-B-3).

### Single-writer
- `capital_reservations` — `CapitalService.reserve` (`apps/capital-service/src/capital/capital.service.ts:70-164`).
- `outbox_events` (CapitalReserved) — там же.

### Читает (read-only у других сервисов)
- `portfolio_positions` — **прямой raw SELECT** `SELECT COALESCE(SUM(notional_usd),0) AS sum FROM portfolio_positions WHERE quantity <> 0` (`capital.service.ts:89`). ⚠️ **Архитектурный компромисс**: в строгой single-writer архитектуре capital-service читал бы позиции через HTTP к portfolio-service. Здесь же — общая БД (все сервисы на одной Postgres), и capital читает чужую таблицу напрямую. Single-writer `portfolio_positions` = portfolio-service (только он пишет); capital — read-only consumer через shared DB. Это осознанный компромисс для производительности (aggregate ceiling gate под `FOR UPDATE`, без network hop).
- config-service `capital.limits` — `CapitalLimitsService.getMaxActiveCapitalUsd` (`capital-limits.service.ts:93-126`, через HTTP `signedFetch`).

### Capital ceiling (D4-B-3) — `:75-102`
```
ceiling = CapitalLimitsService.getMaxActiveCapitalUsd()
activeTotal = SUM(capital_reservations WHERE state='active') + SUM(portfolio_positions WHERE quantity<>0)
if (activeTotal + requestedUsd > ceiling) → CapitalCeilingExceededError (HTTP 422)
```
Конкурентные `reserve()` сериализуются через `SELECT ... FOR UPDATE` на активных строках reservations.

### HTTP API (`capital/capital.controller.ts`)
- `POST /capital/reservations`, `GET /capital/reservations/:id`, `POST /capital/reservations/:id/release`.

### Настройки
- `CAPITAL_MAX_ACTIVE_USD` — env lower-bound (может только tighten).
- config-service `capital.limits.maxActiveCapitalUsd` (cached 10s, `capital-limits.service.ts:135`).
- Fail-closed в prod: если config недоступен И env не задан → `ServiceUnavailableException` (`:114-121`).
- `CONFIG_SERVICE_URL` / `CONFIG_API_BASE` (3019).

### События
- `CapitalReserved` (v1).

---

## 5. execution-orchestrator

**Назначение:** largest сервис. Исполнение: state machine plan (planned→reserved→armed→executing→completed), multi-leg (DEX↔bridge), on-chain DEX swaps, kill-switch, risk policy. **Live execution path** (wallets, keys).

### Single-writer
- `execution_plans` — `PlansService.create/arm/tryMarkPlanCompletedWhenAllLegsFilled` (`apps/execution-orchestrator/src/plans/plans.service.ts`).
- `execution_legs` + `execution_leg_fill_idempotency` — `LegsService` (`legs/legs.service.ts`).
- `on_chain_transactions` — DEX adapters.
- `wallet_states`, `wallet_keys` (через `WalletManagerService` + `KeyVaultService`).
- `dex_daily_volume` — `DexRiskPolicyService.recordTradeVolume` (`execution/risk/dex-risk-policy.service.ts:258-279`).
- `bridge_transfers` — `BridgeTransferService`.
- `dex_pools` — **сущность существует** (`packages/persistence/src/dex-pool.entity.ts`, с индексами), **но не наполняется**: grep не находит ни одного `INSERT`/`.save(DexPool)` в коде. `PoolDiscoveryService` кэширует пулы **in-memory** (`Map poolCache`, `pool-discovery.service.ts:66`), а не в БД. Таблица фактически пустая — single-writer номинально EO, но writer не реализован.
- `approvals` — DEX flow.
- `outbox_events` (PlanArmed, LegFilled v2, PlanCompleted, DexTransaction{Submitted,Confirmed,Failed}).

### Читает (read-only)
- `capital_reservations` — через HTTP к capital-service (двойной GET для TOCTOU, `plans.service.ts:410-423`).
- `risk_decisions` — через HTTP (`risk-http.client.ts`).
- config `dex.limits`, `dex.live`.

### HTTP API
- `POST /execution/plans`, `POST /execution/plans/multi-leg`, `GET /execution/plans`, `GET /execution/plans/:id`, `POST /execution/plans/:id/link-reservation`, `POST /execution/plans/:id/arm`, `GET /execution/plans/:id/legs`, `GET /execution/plans/:id/on-chain-txs` (`plans/plans.controller.ts`).
- `POST /execution/plans/:planId/begin-execution`, `.../legs/:legId/mark-sent`, `.../mark-acknowledged`, `.../apply-fill` (`legs/plan-leg-actions.controller.ts`).
- `GET /health/dex` — composite (RPC + vault + wallet + mempool, `dex-health.controller.ts` + `execution/dex-health.service.ts`).
- `GET /health/bridges`.
- `GET /metrics` (RPC latency, bridge).

### State machine plan
`planned → reserved → armed → executing → completed` (`plans.service.ts`). `arm` требует approved risk + active reservation (двойная проверка через HTTP). `executing→completed` когда все legs `filled`.

### Multi-leg plan builder (`plans/multi-leg-plan-builder.service.ts`)
- Валидирует последовательность DEX↔bridge (2–8 legs, не более 2 bridge, bridge не смежные, начинается/заканчивается DEX).
- `MultiLegPlaybookConfig` сохраняется в `execution_plans.playbook_config` (JSONB).
- Leg config: `legType: 'dex'|'bridge'`, `venueKey`, `tokenIn/Out`, `amountIn`, `path`, `slippageBps`, bridge: `bridgeKey`, `destinationChainId`, и т.д.

### Venue factory (`execution/venue-factory.service.ts`)
- `VenueKey`: `uniswap-v2 | uniswap-v3 | sushiswap | pancakeswap-v2 | biswap | http | mock | auto | paper-dex`.
- `DEX_VENUE_KEYS` = {uniswap-v2, uniswap-v3, sushiswap, pancakeswap-v2, biswap} (`:33-39`).
- `isLiveVenueKey(key)` → проверяет `DEX_VENUE_KEYS` (`:52-54`).
- `extractVenueKey(plan, leg)` — приоритет: `playbookConfig.legs[i].venueKey` → `dexSwaps[i].venueKey` → `playbookConfig.venueKey` (`:69-111`).
- DEX-адаптеры требуют `DEX_VENUE_ENABLED=true` (`:227-234`).

### Kill-switch (`execution/risk/dex-kill-switch.service.ts`)
- `isLiveHalted()`: приоритет `DEX_LIVE_KILL_SWITCH` env → cached `dex.limits.killSwitch` → fail-closed в prod (`:238-267`).
- `assertLiveNotHalted()` вызывается в `LegsService.markSent` перед live leg (`legs.service.ts:290-292`). Leg остаётся в `created` (retryable).
- Paper legs (`paper-dex`, `http`, `mock`) **никогда** не проходят gate — структурная изоляция.
- Background refresh каждые `DEX_KILL_SWITCH_CACHE_TTL_MS` (30s default, clamp 5s–300s).

### DEX Risk Policy (`execution/risk/dex-risk-policy.service.ts`)
- `evaluateTrade(params)` — protocol/blockedTokens/slippage/positionSize/dailyVolume checks (`:170-251`).
- `getEffectiveConfig()` — `dex.limits` cached 10s + env LOWER-BOUND (env только tighten, `:427-451`).
- `recordTradeVolume(chainId, usd)` — UPSERT в `dex_daily_volume` (`:258-279`). **Single-writer dex_daily_volume = execution-orchestrator.**
- Safe defaults (mirror migration 035): enabled:false, maxSlippageBps:50, maxPositionSizeUsd:500, maxDailyVolumeUsd:5000.

### RPC / Pool / Price (read-only on-chain)
- `RpcProviderManager` (`execution/rpc/rpc-provider-manager.service.ts`) — env `RPC_{ARBITRUM,BASE,BNB}_{MAINNET,TESTNET}_URL` + `_BACKUP_URL` (FallbackProvider). Health check 30s.
- `PoolDiscoveryService` (`execution/pool/pool-discovery.service.ts`):
  - `getPool(chain, address)` — **in-memory** кэш (`Map`, TTL 5 мин `POOL_CACHE_TTL_MS`). В БД не пишет (см. примечание про `dex_pools` выше).
  - **V2**: real `getReserves()` (`:175-181`), `feeBps=30`, `protocol='uniswap-v2'` (`:192`).
  - **V3**: ABI **декларирует** `slot0()` (`:214`), но метод **никогда не вызывается** (нет в `Promise.all` `:220-226`). Вместо цены читается только `liquidity()` (`:229`), и `reserve0=reserve1=BigInt(liquidity)` (`:236-237`) — **это не цена, а фантомные равные числа**. `protocol='uniswap-v3'` (`:240`). Цена V3-пула из этого объекта **невозможна**.
  - **Sushi**: нет отдельного path. Sushi-пулы (V2-совместимые) читаются через тот же V2-path → получают `protocol='uniswap-v2'`. **В discovery-слое Sushi неотличим от UniV2** (хотя тип `protocol` включает `'sushiswap'` в декларации `:41`, это значение никогда не присваивается). **НО execution-слой различает их**: `venue-factory.service.ts:241` `case 'sushiswap'` → `SushiSwapV2Adapter`, `dex-risk-policy.service.ts:54` `allowedProtocols` включает `'sushiswap'`. **Это разрыв между discovery и execution** — venueKey (execution) ≠ protocol (discovery).
- `PriceOracleService` (`execution/price/price-oracle.service.ts`):
  - `getTokenPriceUsd(chain, token)` — 3-tier: stables→$1, WETH/WBNB→Chainlink AggregatorV3, arbitrary→UniV2 pool reserves × WETH-USD.
  - **V3 пулы явно пропускаются в pricing** (`:221-224`).
  - `findTokenWethPool` итерирует cached pools, возвращает первый подходящий (token+weth), НЕ per-venue.
  - `getTokenDecimals` — cached permanently.
  - Кэш цены 10s, single-flight.

### Slippage / Gas
- `SlippageProtectionService` (`execution/slippage/slippage-protection.service.ts`) — pure math, constant-product price impact + pool.feeBps.
- `GasEstimatorService` (`execution/gas/gas-estimator.service.ts`) — `MAX_GAS_PRICE_GWEI`, `MAX_PRIORITY_FEE_GWEI`, `GAS_POLICY_{CHAINID}_MAX_FEE_GWEI`.

### Bridge (`execution/bridge/`)
- Adapters: Across, Stargate, Native (Optimism/Arbitrum/Base) — `bridge-adapter-factory.service.ts`.
- `BridgeTransferService` — submit + track, idempotency.
- `BridgeFinalityService` (D4-B-5) — `BRIDGE_FINALITY_CONFIRMATIONS`.
- Workers: `BridgeTransferPollingWorker` (`BRIDGE_POLLING_ENABLED`, `BRIDGE_POLLING_INTERVAL_MS` 30s), `CrossChainReconWorker`, `DexMempoolMonitorWorker` (`MEMPOOL_MONITOR_ENABLED`).

### Настройки (env, выборка)
- `DEX_VENUE_ENABLED` — включает DEX-адаптеры.
- `DEX_LIVE_KILL_SWITCH`, `DEX_KILL_SWITCH_CACHE_TTL_MS`, `DEX_KILL_SWITCH_HTTP_TIMEOUT_MS`.
- `DEX_MAX_SLIPPAGE_BPS`, `DEX_MAX_POSITION_SIZE_USD`, `DEX_MIN_POOL_LIQUIDITY_USD` (env lower-bounds).
- `RPC_*_URL`, `RPC_*_BACKUP_URL`.
- `EXECUTION_BEGIN_LEG_COUNT` (1, legacy single-chain legs).
- `VENUE_HTTP_BASE_URL` (для HTTP venue adapter).
- config-service: `dex.limits`, `dex.live` (через `CONFIG_SERVICE_URL`/`CONFIG_API_BASE`).

### События
- `PlanArmed`, `LegFilled` (v2 с dex-метаданными), `PlanCompleted`, `DexTransactionSubmitted/Confirmed/Failed`.

### Outbound HTTP
- capital-service (`CapitalHttpClient`), risk-service (`RiskHttpClient`), audit (`AuditClientService`).

---

## 6. audit-service

**Назначение:** append-only журнал действий. Single-writer `audit_log` (единственное число).

### Single-writer
- `audit_log` (единственное число, `@Entity({ name: 'audit_log' })` — `packages/persistence/src/audit-log.entity.ts:8`) — `AuditService.append` (`apps/audit-service/src/audit/audit.service.ts:31-84`). Idempotency по `idempotencyKey` (pessimistic_write + unique violation catch).

### HTTP API (`audit/audit.controller.ts`)
- `POST /audit/entries` (`AppendAuditDto`: `actor, action, resourceType?, resourceId?, payload?, correlationId?, idempotencyKey?`).
- `GET /audit/entries?limit=`.

### Использование
- `AuditClientService` из `@arbibot/nest-platform` — все сервисы пишут аудит (risk, capital, execution, paper).

---

## 7. canonical-market-service

**Назначение:** key-value resolver для venue/instrument/route identity. **НЕ детектор, НЕ реестр арбитражных пар.**

### Single-writer
- `venue_refs`, `canonical_instruments`, `canonical_routes` — **заполнение НЕ через этот сервис** (нет CRUD endpoints; seed ручной/через БД). Сервис только читает.

### HTTP API (`market/market.controller.ts`) — только 2 endpoints!
- `POST /market/resolve-instrument` — по `canonicalKey` ИЛИ `(venueCode, venueSymbol)`.
- `POST /market/resolve-route` — по `routeKey` ИЛИ `(sourceInstrumentId, targetInstrumentId)`.

### Логика (`market/market.service.ts`)
- `resolveInstrument` — lookup в `canonical_instruments` (+ `venue_refs` join для venueCode), Redis-кэш 90s (`:59-115`).
- `resolveRoute` — lookup в `canonical_routes`, idempotent по `(source, target)` (`:117-164`).
- **Нет enumeration** — нельзя «перечислить все venue для токена». **Нет концепции арбитражной пары** (buy venue / sell venue для одного токена).

### Настройки
- `REDIS_URL` (опционально — без Redis работает напрямую с БД).

---

## 8. market-intake-service

**Назначение:** ingest рыночных snapshots (bid/ask/last per venue). Single-writer `market_snapshots`. Throttling + tier routing.

### Single-writer
- `market_snapshots` — `SnapshotsService.ingest` (`apps/market-intake-service/src/snapshots/snapshots.service.ts`).
- `market_snapshot_ingest_idempotency` — там же (sha256 fingerprint + `pg_advisory_xact_lock`).
- `outbox_events` (SnapshotUpdated v2).

### HTTP API (`snapshots/snapshots.controller.ts`)
- `POST /snapshots/ingest` — `IngestMarketSnapshotDto`: `idempotencyKey?, correlationId?, venueCode!, venueSymbol!, canonicalInstrumentId?, instrumentKey?, routeKey?, bid?, ask?, last?, payload?, observedAt!, staleAfterSeconds?`. При throttle → 429 `{throttled:true, reason}`.
- `GET /snapshots/fresh?limit=` — для discovery pipelines (paper-trading-service это **вызывает**).
- `GET /snapshots?venueCode=&venueSymbol=`.
- `GET /health/degradation` — `{degraded, fallbackMode, degradationReasons}`.

### Throttling (`policy/intake-throttle.service.ts:80-131`)
- `INTAKE_THROTTLING_ENABLED=true` — иначе всегда allow (tier `disabled`).
- Tier routing: `hot`/`warm`/`cold` из `intake.routing.tiers` config + risk `watchlist/tiers` (`:34-61`).
- `hot` → всегда allow. `warm`/`cold` → sampling по интервалу (`warmSampleIntervalMs` 5000, `coldSampleIntervalMs` 30000).
- Optional `routeKey` score gate (`intake.throttling.minRouteScore`).

### Policy cache (`policy/policy-cache.service.ts`)
- `getBundle()` — TTL `INTAKE_POLICY_CACHE_TTL_MS` (default 120s, clamp 61s–300s), single-flight.
- Читает config `intake.throttling`, `intake.routing.tiers` + risk `GET /policy/watchlist/tiers` + risk `GET /policy/route-scoring-history/:routeKey`.
- Fallback mode: на ошибку fetch → `intakePolicyFallbackTotal`, stale cache.

### Настройки
- `INTAKE_THROTTLING_ENABLED`, `INTAKE_POLICY_CACHE_TTL_MS`, `INTAKE_POLICY_HTTP_TIMEOUT_MS` (8000).
- `INTAKE_CONFIG_ENVIRONMENT`, `INTAKE_CONFIG_TENANT_ID` (для scope querystring).
- `CONFIG_SERVICE_URL`/`CONFIG_API_BASE`, `RISK_SERVICE_URL` (3000).

### События
- `SnapshotUpdated` (v2).

### Consumers of snapshots
- **paper-trading-service `fetchFreshSnapshots`** (`apps/paper-trading-service/src/paper-discovery/paper-discovery.service.ts:497-549`) — `GET /snapshots/fresh`.
- `packages/outbox-kafka-bridge` публикует `SnapshotUpdated` в Kafka (отдельный publisher).

---

## 9. portfolio-service

**Назначение:** single-writer `portfolio_positions` (settlement — агрегация fills).

### Single-writer
- `portfolio_positions` — `PositionsService.confirmFill` (`apps/portfolio-service/src/positions/positions.service.ts:41-81`), `close` (`:83-160`).
- `portfolio_position_fill_idempotency`, `portfolio_position_close_idempotency`.

### Читает
- Ничего чужого напрямую (fills приходят через HTTP).

### HTTP API (`positions/positions.controller.ts`)
- `GET /positions`, `POST /positions/confirm-fill` (`ConfirmFillDto`: `planId, instrumentKey, legId, quantity, notionalUsd?, idempotencyKey`), `POST /positions/:id/close`.

### Capital ceiling зависимость
- `capital-service` **читает** `portfolio_positions` (`SUM(notional_usd) WHERE quantity<>0`) для ceiling. **Не пишет** — read-only consumer.

---

## 10. reconciliation-service

**Назначение:** детекторы рассинхрона OLTP-таблиц + alertmanager webhook ingestion. Single-writer `reconciliation_mismatches`, `alertmanager_incidents`.

### Single-writer
- `reconciliation_mismatches` — `MismatchesService.runDetectors` / `updateStatus` (`apps/reconciliation-service/src/mismatches/mismatches.service.ts`).
- `alertmanager_incidents` — `AlertIncidentsService`.

### HTTP API
- `GET /mismatches`, `POST /mismatches/run-detectors`, `PATCH /mismatches/:id` (`mismatches/mismatches.controller.ts`).
- `POST /alerts/webhook`, `POST /alerts/ingest`, `GET /alerts`, `GET /alerts/incidents`, `PATCH /alerts/incidents/:id` (`alerts/alerts.controller.ts`).

### Детекторы (`mismatches/dex-reconciliation.detectors.ts` + `mismatches.service.ts:66-119`)
- `completed_plan_missing_portfolio` — completed plan без portfolio_positions.
- `executing_plan_legs_filled_not_completed` — plan executing, все legs filled, но plan не completed.
- `dex_receipt_leg_mismatch` — on-chain tx confirmed/reverted vs leg state.
- `wallet_balance_drift` — stale `wallet_states.eth_balance_updated_at`.
- `dex_stale_pending_tx` — pending `on_chain_transactions` > threshold.
- Идемпотентные inserts (NOT EXISTS guard для open rows).

### Читает (read-only у других)
- `execution_plans`, `execution_legs`, `portfolio_positions`, `on_chain_transactions`, `wallet_states` — SELECT в детекторах. **Не пишет в них.**

---

## 11. paper-trading-service

**Назначение:** paper-режим: виртуальные сделки, promotion candidates, drift, discovery cycle. Полностью изолирован от live.

### Single-writer
- `paper_trades` — `PaperTradesService` (`apps/paper-trading-service/src/paper/paper-trades.service.ts`). State: `draft → active → settled|canceled`.
- `paper_promotion_candidates` — `PaperPromotionService` (`paper/paper-promotion.service.ts`). State: `queued → under_review → promoted|rejected|expired`.
- `paper_drift_samples` — `PaperDriftService`.
- `paper_capital_reservations` — `PaperCapitalService` (virtual capital, TTL 60 min).
- `paper_discovery_candidates` — `PaperDiscoveryService` (paper-trading-service variant).

### HTTP API
- `GET/POST/PATCH /paper/trades`, `GET/POST/PATCH /paper/promotion-candidates`, `GET/POST /paper/drift-samples` (`paper/paper-trades.controller.ts` и др.).
- `GET /paper/promotion-criteria`, `GET /paper-discovery/candidates`, `POST /paper-discovery/trigger`.

### Paper discovery cycle (`paper-discovery/paper-discovery.service.ts`)
- `fetchFreshSnapshots()` — `GET ${MARKET_INTAKE_SERVICE_URL}/snapshots/fresh` (`:497-549`).
- `profileSnapshot` — `spread = askPrice - bidPrice` (**single-venue bid-ask**, НЕ cross-DEX), `theoreticalProfitUsd = spread` (`:628-629`), `liquidityScore` (`:603-650`). ⚠️ **`theoreticalProfitUsd` — БРУТТО**: TODO `:627` явно гласит «Add fee estimation and slippage calculation» — комиссии DEX и газ **не вычитаются**. Реальная чистая прибыль будет ниже. Для любого сканера/profit-gate, опирающегося на эти числа, это критично.
- Фильтр по paper-only token/route (config `paper.discovery` или env).
- Worker `paper-discovery-worker.ts`: `setInterval(intervalMs)`, `isRunning` guard, метрики `arb_paper_discovery_*`.

### Promotion quality (`paper-promotion.service.ts:21-36`)
- `promotionQualityFor`: tier (high/medium/low) из score + driftBps.
- Gates: `PAPER_PROMOTION_MAX_DRIFT_BPS` (50), `PAPER_PROMOTION_MIN_SCORE`.

### Drift worker (`paper/paper-drift-worker.ts`)
- `updateStaleGauges` — reset gauges для инструментов без свежих samples (30 min).

### Настройки
- `MARKET_INTAKE_SERVICE_URL` — обязателен для discovery.
- `PAPER_DISCOVERY_*` (interval, minProfit, minLiquidityScore, maxCandidatesPerRun, paperOnlyTokens/Routes) или config `paper.discovery`.
- `PAPER_PROMOTION_MAX_DRIFT_BPS`, `PAPER_PROMOTION_MIN_SCORE`.

### Изоляция
- **Не импортирует** wallet/key-vault/bridge/live-adapters (CI guard `tools/ci-paper-live-boundary.sh`).

---

## 12. config-service

**Назначение:** single-writer `policy_configurations`. CRUD конфигов с scope (global/environment/tenant), rollback, promote, effective resolution.

### Single-writer
- `policy_configurations` — `ConfigurationsService` (`apps/config-service/src/config/configurations.service.ts`).

### HTTP API (`config/config.controller.ts`)
- `GET /policy/configurations` (scope filter), `GET /policy/configurations/:configKey[/effective|/history]`.
- `POST /policy/configurations`, `PUT /policy/configurations/:configKey` — **требуют `operatorId`** в body (400 если нет).
- `POST /policy/configurations/:configKey/rollback`, `/promote`, `PATCH .../status` (activate draft).
- **Sensitive keys** (`risk.*`, `execution.*`, `capital.*`) требуют `approveReason`.
- Redis cache 60s.

### Panic (`config/panic.controller.ts` + `panic.service.ts`)
- `POST /panic` (`PanicActionDto`) → `panicStop` (`panic.service.ts:48-59`) flip-ает `dex.limits.killSwitch=true` в `policy_configurations`. Idempotent (no-op если уже true).
- **Цепочка влияния на execution**: `dex.limits.killSwitch` (config) → `DexKillSwitchService` в execution-orchestrator читает это значение через cache каждые `DEX_KILL_SWITCH_CACHE_TTL_MS` (30с по умолч.) → применяется в `LegsService.markSent` (`assertLiveNotHalted`, блокирует live legs). Т.е. panic пишет config-service, но **действие** происходит в execution-orchestrator с задержкой до 30с (cache TTL).
- ⚠️ panic.service.ts явно отмечает (`:26-29`): UI panic — НЕ полная поверхность. Для полной остановки оператор должен также запустить CLI `tools/panic-button.sh` (флипает `PAPER_DISCOVERY_ENABLED` и др.). UI возвращает инструкцию.
- Используется `npm run panic:stop` / `npm run panic:recover`.

### Effective resolution
- DB-функция `get_effective_config_value(key, env, tenant)` — scope fallback: specific → environment → global (`:50-65`).

### Настройки
- `REDIS_URL` (cache), `AUDIT_CLIENT_ENABLED`.

---

## 13. hermes-gateway

**Назначение:** stateless API-gateway для Hermes Agent (GLM 5.2 + Telegram). Прокси read/mutations к backend, config-management (Plan 6).

### HTTP API
- **Read** (`hermes/hermes.controller.ts`, `@UseGuards(HermesAuthGuard)` через `HERMES_API_KEYS`):
  - `GET /hermes/v1/plans` (cursor pagination), `GET /hermes/v1/plans/:id` (+ legs), `GET /hermes/v1/positions`, `GET /hermes/v1/incidents`, `GET /hermes/v1/dashboard/summary` (read-through operator web BFF), `GET /hermes/v1/incident-briefs`, `GET /hermes/v1/approvals-queue`, `GET /hermes/v1/safe-mode/status`.
  - **Scanner read-through** (S4-4-HERMES): `GET /hermes/v1/scanner/findings` (instanceId/publishStatus/limit), `/scanner/findings/:id`, `/scanner/status` → scanner-service `/scanner/*` via `getScannerApiBase()` (`SCANNER_API_BASE`).
- **Config read** (`hermes/hermes-config.controller.ts` `HermesConfigReadController`): `GET /hermes/v1/config/*` — read-only proxy к config-service, **без allowlist** (можно читать sensitive).
- **Config mutation** (`HermesConfigMutationController` + `HermesMutationRateLimitGuard`): `PUT /hermes/v1/config/:configKey`, `POST .../rollback`, `/promote`, `PATCH .../status`. **Apply allowlist** (`config-allowlist.ts`): только безопасные ключи (`intake.*`, `paper.*`, `opportunity.*`, `dex.*`, `features.*`, `scanner.*`); `risk.*`/`execution.*`/`capital.*` → **403**.
- **Operator mutations** (`hermes/hermes-mutation.controller.ts`): `POST /hermes/v1/plans/:id/arm`, `/execute`, `positions/:id/close`, `incidents/:id/resolve`, `safe-mode/enable`, `/disable`.
- **Safe-mode** (`safe-mode.service.ts`) — stateful (in-memory or DB), gating mutations.

### Настройки
- `HERMES_GATEWAY_PORT` (3020), `HERMES_API_KEYS` (comma-sep, header `x-hermes-api-key`).
- `EXECUTION_API_BASE`, `PORTFOLIO_API_BASE`, `RECONCILIATION_API_BASE`, `AUDIT_API_BASE`, `OPERATOR_WEB_BFF_BASE`, `CONFIG_API_BASE`.
- `HERMES_SIGN_UPSTREAM` (true в live → подпись upstream), `HERMES_BFF_API_KEY`.

---

## 14. apps/web (Operator UI)

**Назначение:** Next.js App Router. BFF-прокси к backend. Pages + components.

### BFF routes (`app/api/operator/*/route.ts`)
Полный список (39 routes) — см. вывод find выше. Канон: `proxyUpstream(${apiBases.X}/path)` (`lib/operator-bff-proxy.ts`) ИЛИ session-checked manual fetch.

### apiBases (`lib/api-base.ts`)
`risk, opportunity, capital, execution, audit, portfolio, reconciliation, paper, config, marketIntake, scanner` — из `*_API_BASE` env. canonical/hermes не имеют apiBases-entrance (hermes через catch-all `[[...path]]`).

### Pages (`app/(operator)/`)
`dashboard, portfolio, opportunities[/:id], execution[/:id], tokens, paper, scanners, incidents, runbooks, hermes, settings` + `login`, root redirect. **`/scanners`** (S4-3-UI) — таблица инстансов + findings drilldown (→ `/opportunities/[id]`), Run/Refresh-config/re-publish actions.

### Settings (`/settings`)
- `components/settings-workspace.tsx` — tabs: overview, policies, intake, paper, dex, extensions, diagnostics.
- **Policy registry** (`lib/policy-config-registry.ts`) — canonical список config-ключей с zod-схемами для валидации:
  - Зарегистрированы: `intake.throttling`, `intake.routing.tiers`, `paper.discovery`, `opportunity.filters`, `risk.evaluation`, `risk.limits.bundle`, `execution.plan`, `capital.reservation`, `features.flags`, **`scanner.defaults`**, **`scanner.instances`** (S0-6-REGISTRY).
  - `validateConfigJson(key, rawJson)` — zod safeParse перед save.
- Structured editors в `components/settings-policy-editor-panels.tsx` (например `PaperDiscoveryPanel`). scanner.instances сегодня редактируется через Extensions catalog JSON editor (struct editor — backlog).

### React Query
- `lib/query-client.ts` — `staleTime: 10s`, `gcTime: 5min`, `refetchOnWindowFocus: false`.
- `lib/operator-query-keys.ts` — `operatorKeys` (tuple keys).
- `lib/operator-client-api.ts` — `fetchOperatorBffJson(path)` → `/api/operator${path}`.

### DEX config panels (`lib/use-dex-config.ts`, `lib/dex-config-types.ts`)
- `useDexLive`, `useDexKillSwitch` — modern hook pattern (useQuery + useMutation).
- `dex.limits` (sensitive), `dex.live` (sensitive) — панели с `DestructiveOperatorAction`.

### Auth / RBAC
- **Signed JWT cookie `arbibot_session`** (D4-A-1, [`docs/adr-operator-auth.md`](adr-operator-auth.md)) — единственный доверенный источник сессии в production. Выдаётся `POST /api/auth/session` после проверки `OPERATOR_BOOTSTRAP_TOKEN`; claims: `sub` (operatorId для audit), `role`, `iat`, `exp` (8h), `jti`. Верифицируется в Edge middleware (`apps/web/middleware.ts`) и RSC (`apps/web/lib/operator-session.ts` → `verifyOperatorSession` из `lib/auth/session.ts`).
- Роли: viewer/operator/admin (`lib/operator-role.ts`); `minimumRoleForPathname` для path-gating.
- `ARBIBOT_DEV_ROLE` — **no-op в production** (defense-in-depth, F4: `NODE_ENV !== 'production'` guard). Работает только в dev.
- Cookie-атрибуты: `httpOnly: true`, `sameSite: 'lax'`, `path: '/'`, **`secure`** — определяется `cookieSecure()` (`lib/auth/session.ts`): default `NODE_ENV === 'production'`, override через env **`OPERATOR_COOKIE_SECURE`** (`true`/`1` → secure; `false`/`0` → plain для paper-HTTP-через-SSH-туннель; невалидное → default). JWT signing/verification (`getSessionSecret`) остаётся fail-closed в production независимо.
- `OPERATOR_SESSION_SECRET` (≥32 bytes, required in prod), `OPERATOR_BOOTSTRAP_TOKEN`, `OPERATOR_SESSION_TTL_SECONDS` (28800). На paper-стенде Aéza: `OPERATOR_COOKIE_SECURE=false` (см. [`docs/paper-deploy-aeza.md`](paper-deploy-aeza.md) §«Аутентификация»).

---

## 14a. scanner-service

**Назначение:** автономный cross-DEX spread detector — **mode-agnostic data-provider** (ни paper, ни live). Запустили → ищет → публикует findings через `POST /opportunities` → STOP. Решение live/paper — в существующем pipeline (оператор/риск/execution). См. [`docs/scanner-service-plan.md`](scanner-service-plan.md), [`docs/adr-scanner-service.md`](adr-scanner-service.md).

### Single-writer (владение)
- `scanner_instances` (table) — runtime-only status (instance_id, last_run_at, status, cycles_total, findings_total, last_cycle_latency_ms). **Без config-полей, без `enabled`** (config в config-service). Upsert each cycle.
- `scanner_findings` (table) — найденные cross-venue deals: spread_bps, gross/net_profit_usd, fees_usd, buy/sell_venue + pool_addr, opportunity_id (FK после POST /opportunities), publish_status (pending|published|failed), publish_attempts. Retention worker (S5-2) удаляет старше `scanner.defaults.findingsRetentionDays` (default 7).

### HTTP API (`scanner.controller.ts`, `/scanner/*`)
- **Read**: `GET /scanner/instances` (config join runtime), `/instances/:id`, `/findings` (instanceId/publishStatus/limit filters), `/findings/:id`, `/status` (worker runtime: scheduled/running ids, isShuttingDown).
- **Mutations**: `POST /scanner/instances/:id/refresh-config` (force-refresh config cache), `/instances/:id/run` (manual cycle trigger), `/findings/:id/re-publish` (manual publish retry — operator fallback for orphan worker).
- Health: `GET /health`, `GET /metrics` (arb_scanner_*).

### Config (`scanner.*` in config-service)
- `scanner.defaults` — fallback filters (minSpreadBps, minLiquidityUsd, volumeRange, blacklistTokens, allowedChains, quoteAssets) + RPC budget + retention + orphan retry settings.
- `scanner.instances` — массив инстансов (id, network, strategy, interval_ms, filters, poolWhitelist, enabled). Operator управляет через `/settings` или Hermes (Telegram).

### Pipeline (per cycle, per instance)
read pools (RPC, rate-limited) → cross-venue spread → volume (if filter on) → filters → dedup → WRITE findings + UPSERT instances → POST /opportunities → save opportunity_id. На failure: retry (3× exp backoff) → `publish_status=failed` → orphan worker (max 5 cumulative) → manual re-publish.

### Reads (не владеет)
- On-chain RPC (Arb/Base/BNB) — read-only, изолированный budget `RPC_SCANNER_*_URL` (fallback shared `RPC_*_URL`).
- config-service `scanner.*` (TTL cache 30s, force-refresh endpoint).
- canonical-market-service `POST /market/resolve-instrument` (point-lookup; enumeration endpoint отсутствует — pool universe = whitelist в config).
- risk-service (опц. pre-filter) `GET /policy/token-profiles`, `/route-profiles`.

### Outbound (signedFetch)
- `POST /opportunities` (rich payload — заполняет spreadBps/profitUsd/feesUsd/volumeUsd/token/chain/quoteAsset/buyVenue/sellVenue/routeKey/instrumentKey) → scanner-service (Phase 3b) пишет `arbitrage_opportunities` + `OpportunityDetected` outbox.
- `POST /audit/entries` через `AuditClientService`.

### Metrics (`arb_scanner_*`)
cycles_total, spreads_detected_total, findings_written/filtered_total, spread_bps (hist), volume_usd (hist), rpc_latency_ms (hist), rpc_rate_limited_total, rpc_failures_total, rpc_tokens_available (gauge), opportunities_published_total, opportunity_publish_failed_total{reason: config/http_5xx/http_4xx/timeout/network/bad_response}, orphan_republish_total{status: success/failed/exhausted}, pool_cache_hits/misses_total, pool_cache_hit_ratio (gauge), volume_revert_total, volume_reads/log_scans_total, findings_cleaned_total.

### Env vars
`PORT` (3021), `DATABASE_URL`, `RPC_SCANNER_{ARBITRUM,BASE,BNB}_URL` (+ `_BACKUP_URL`), `SCANNER_RPC_RATE_LIMIT_RPS` (10), `CONFIG_API_BASE`/`CONFIG_SERVICE_URL` (3019), `OPPORTUNITY_SERVICE_URL` (3010), `CANONICAL_MARKET_SERVICE_URL` (3014), `RISK_SERVICE_URL` (3000, опц.), `SCANNER_POOL_CACHE_TTL_MS` (30000), `SCANNER_CONFIG_CACHE_TTL_MS` (30000), `SCANNER_FINDINGS_RETENTION_DAYS` (7), `SCANNER_RETENTION_INTERVAL_MS` (3600000), `SCANNER_RETENTION_ENABLED` (true), `SCANNER_ORPHAN_*`, `SCANNER_OPPORTUNITY_PUBLISH_TIMEOUT_MS` (5000), `ARBIBOT_SERVICE_AUTH_SECRET`/`ARBIBOT_SERVICE_AUTH_ENABLED`, `LOG_LEVEL`/`ARBIBOT_LOG_PRETTY`.

---

## 15. Shared пакеты (packages/*)

### `@arbibot/contracts` (`packages/contracts/src/index.ts`)
- `SERVICE_IDS` — 9 service IDs.
- `*_HTTP_ROUTES` — канонические пути всех сервисов.
- `events.ts` — `EVENT_NAMES` (11 типов) + payload types (v1/v2).
- `dex-filters.types.ts` — **полная система типов фильтров** (`DexFilters`, `DexFiltersConfig`, `DEFAULT_DEX_FILTERS_CONFIG`): `minSpreadPct, minProfitUsd, maxFeesUsd, volumeRange, blacklistTokens, allowedChains, quoteAssets, highRisk`.

### `@arbibot/contracts-eth` (`packages/contracts-eth/src/index.ts`)
- ABIs: UniV2/V3/Sushi **Router**, ERC20, AggregatorV3, bridges (Across, Stargate, Native, LayerZero V2).
- Addresses: Arbitrum/Base/BNB (mainnet+testnet) + Bridges + LayerZero.
- Types: `ChainId` (1/11155111, 42161/421614, 8453/84532, 56/97), `Address`, helpers.
- **Нет Factory/Pair/Pool ABI как экспорта** — инлайн в PoolDiscoveryService.

### `@arbibot/persistence` (`packages/persistence/src/index.ts`)
- **38 сущностей** + `ARBIBOT_TYPEORM_ENTITIES` (массив для TypeORM registration). Полный список — в `index.ts:87-125`. Это канон single-writer границ (каждая таблица принадлежит ровно одному сервису).

### `@arbibot/messaging` (`packages/messaging/src/index.ts`)
- `fetchLockedOutboxBatch(em, limit, eventTypes)` — `FOR UPDATE SKIP LOCKED` (`outbox-poll.ts`).
- `tryClaimInboxMessage(em, consumerId, messageId, payloadHash?)` — idempotent inbox insert (`inbox.ts`).

### `@arbibot/nest-platform` (`packages/nest-platform/src/index.ts`)
- `signedFetch(input, init)` — HMAC outbound (`service-auth/fetch-signer.ts`).
- `createServiceAuthPreHandler`, `applyArbibotHttpSecurity` — inbound guard + CORS.
- `getArbibotMetricsRegistry()`, `installMetricsOnFastify` — Prometheus.
- `correlationIdPreHandler`, `getCorrelationId` — correlation ID.
- `PinoLoggerService`, `configureArbibotLogger`.
- `KeyVaultModule`/`KeyVaultService`/`WALLET_KEY_STORE` — encrypted key persistence (live context).
- `AuditClientModule`/`AuditClientService` — audit append.
- `HealthModule`/`HealthController`.
- `startOpenTelemetryNodeSdkIfConfigured`.

### `@arbibot/nest-database`
- `DatabaseModule`, Redis helper.

### `@arbibot/outbox-kafka-bridge`
- `publishOneSnapshotUpdated(ds, producer, topic)` — публикует `SnapshotUpdated` в Kafka. Фильтр event_type: `SnapshotUpdated, CapitalReserved, PlanArmed, LegFilled, PlanCompleted`.

### `@arbibot/hermes-mcp-server`
- MCP server (stdio), 22 tools → hermes-gateway HTTP. Tools: plans, positions, incidents, safe-mode, config, dashboard, audit.

---

## 16. Cross-cutting инфраструктура

### Service-to-service auth (HMAC, D4-B-6)
- `ARBIBOT_SERVICE_AUTH_ENABLED` (default true в prod), `ARBIBOT_SERVICE_AUTH_SECRET` (≥32 chars).
- Все межсервисные вызовы — через `signedFetch` (header `x-arbibot-signature` + `x-arbibot-body-sha256`).

### Outbox/Inbox паттерн
- Publisher пишет `outbox_events` в той же tx что и domain-change.
- Relay (`fetchLockedOutboxBatch`) — `FOR UPDATE SKIP LOCKED`, per-event-type allowlist.
- Consumer — `tryClaimInboxMessage` (unique на consumer_id+message_id → idempotent).

### Kill-switch
- `DEX_LIVE_KILL_SWITCH` env (operator emergency) → `dex.limits.killSwitch` config (cached 30s).
- Применяется в `LegsService.markSent` только для live legs (`isLiveVenueKey(venueKey)` || bridge leg).

### Миграции
001–045. Ключевые таблицы: см. раздел 1 (single-writer mapping). **044_scanner.sql** + **045_scanner_config_seed.sql** — scanner-service tables + config seed (S0-4/S0-5).

### Dependency security (overrides, 2026-07-23)
- `package.json` **`overrides`** пиннят transitive-зависимости для закрытия Dependabot advisories: `fast-uri ^3.1.4`, `find-my-way ^9.7.0`, `sharp ^0.35.0`, плюс nested `next.postcss`, `@istanbuljs/load-nyc-config.js-yaml`.
- **Гочча npm overrides в этом монорепо:** overrides применяются **только при свежем резолве**. Если `package-lock.json` уже закрепил старую версию, `npm install` молча переиспользует её, override не сработает (симптом: `npm explain <pkg>` показывает старую версию, `npm audit` остаётся красным). Надёжная процедура: `rm -rf node_modules package-lock.json && npm install`.
- Журнал закрытых/принятых рисков: [`docs/security-accepted-risks.md`](security-accepted-risks.md). Принятый риск: `@hono/node-server <2.0.5` (moderate, path traversal в `serve-static` на Windows) — upstream-blocked (`@modelcontextprotocol/sdk@1.29.0` пинит `^1.x`, выше версий нет), но уязвимый HTTP-путь не достигается, т.к. `hermes-mcp-server` работает на stdio-транспорте.

---

## 17. Существующий pipeline (сквозной поток)

```
[внешний источник / manual POST / paper-discovery]
  ↓
market-intake: POST /snapshots/ingest → market_snapshots + SnapshotUpdated outbox
  ↓ (paper-trading-service тянет /snapshots/fresh)
paper-trading: paper_discovery_candidates → paper_trades (virtual)

[opportunity detection — cross-DEX spread detector: scanner-service (apps/scanner-service, port 3021)]
  │ read on-chain RPC (per-venue prices) → spread → filters → dedup → scanner_findings
  ↓ POST /opportunities (rich payload, signedFetch)
opportunity-service: POST /opportunities → arbitrage_opportunities (state=detected)
  └─ Phase 3b: writes OpportunityDetected outbox (observability; does NOT drive detected→risk_checked)
  ├─ enrich (detected→enriched)
  ├─ request-risk-evaluation → risk-service POST /evaluate-risk → risk_decisions + RiskDecisionIssued outbox
  │    ↓ (OutboxRelay: RiskDecisionIssued → opportunity state=risk_checked)
  └─ paper-enqueue → PaperPromotionCandidateRequested outbox → (relay HTTP) → paper-trading

[live execution path]
capital-service: POST /capital/reservations → capital_reservations + CapitalReserved outbox (capital ceiling gate)
  ↓
execution-orchestrator:
  POST /execution/plans → planned
  POST .../link-reservation → reserved (double-check risk+reservation via HTTP)
  POST .../arm → armed + PlanArmed outbox (kill-switch check)
  POST .../begin-execution → executing + legs (multi-leg playbook)
  POST .../legs/:id/mark-sent → sent (venue adapter: DEX swap / bridge transfer / paper-dex)
  POST .../legs/:id/apply-fill → filled + LegFilled outbox
  tryMarkPlanCompletedWhenAllLegsFilled → completed + PlanCompleted outbox
  ↓
portfolio-service: POST /positions/confirm-fill → portfolio_positions (settlement)
  ↓
reconciliation-service: POST /mismatches/run-detectors → reconciliation_mismatches (детекторы)
```

---

## 18. Чего НЕТ в коде (важные пробелы для проектирования)

Эти вещи отсутствуют — **не предлагать как существующие** при проектировании новых функций:

| Возможность | Статус | Где проверено |
|---|---|---|
| **Cross-DEX арбитраж** (сравнение цен 2 venue → opportunity) | ✅ **scanner-service** (apps/scanner-service, port 3021) | Phase 0-5 done (2026-07-25). Cross-venue spread detector → POST /opportunities. См. §14a, [`docs/scanner-service-plan.md`](scanner-service-plan.md). |
| **Scanner service / scanner.config / arbitrage_pairs** | ✅ **scanner-service** | `scanner.instances` + `scanner.defaults` config keys (config-service); `scanner_instances`/`scanner_findings` tables (migration 044). |
| **Per-venue цены** (цена WETH на uniswap-v3 vs sushiswap отдельно) | **0** | `PriceOracle.getTokenPriceUsd` отдаёт 1 каноническую цену |
| **`slot0()` для UniV3 pricing** | **не вызывается** | `pool-discovery.service.ts`: ABI декларирует slot0 (`:214`), но в `Promise.all` его нет — читается только `liquidity()` (`:229`), `reserve0=reserve1=BigInt(liquidity)` (`:236-237`) — это не цена, а фантомные равные числа. Цена V3-пула из `DiscoveredPool` **невозможна** |
| **Различение Sushi от UniV2 в discovery-слое** | **нет** | `PoolDiscoveryService` ставит `protocol='uniswap-v2'` для обоих (`:192`). НО execution-слой различает их по venueKey (`venue-factory.service.ts:241`, `SushiSwapV2Adapter`, `allowedProtocols` включает `'sushiswap'`). **Разрыв между discovery и execution**: venueKey (execution) ≠ protocol (discovery) |
| **Opportunity payload fields producer** (spreadPct/profitUsd/volumeUsd/...) | **0 producer** | `previewFilters` читает с `?? 0`; `getMetrics` возвращает mock |
| **Observed/market volume** (hourly/24h) | **0** | `dex_daily_volume` = executed notional per-chain (single-writer EO) |
| **Канонический `arb:{chain}:{PAIR}:...` instrumentKey** | **0** | есть только `arb:opportunity:{id}`, `paper.discovery:{token}` |
| **Enumeration venue-for-token в canonical-market** | **нет** | только point-lookup resolve-instrument/route |
| **Paper/live isolation CI для scanner-service** | **нет** | `ci-paper-live-boundary.sh` покрывает paper-trading-service |
| **Scanner в policy-config-registry** | **нет** | реестр содержит 9 ключей, `scanner.*` отсутствует |

---

## 19. Где искать канонические настройки (при проектировании)

| Что | Где | Как добавить новое |
|---|---|---|
| HTTP routes | `packages/contracts/src/index.ts` (`*_HTTP_ROUTES`) | добавить в объект |
| Event payloads | `packages/contracts/src/events.ts` | добавить тип + `EVENT_NAMES` |
| Filter types | `packages/contracts/src/dex-filters.types.ts` | расширить `DexFilters` |
| Entity (single-writer) | `packages/persistence/src/*.entity.ts` + index + миграция | новая сущность = определить owner-сервис |
| Config key | config-service `policy_configurations` + миграция seed (по образцу 032/035) + `apps/web/lib/policy-config-registry.ts` (zod) | register entry → появляется в UI |
| UI BFF route | `apps/web/app/api/operator/<area>/.../route.ts` + `lib/api-base.ts` (если новый сервис) | proxyUpstream pattern |
| UI nav link | `apps/web/components/operator-nav.tsx` (`links` array) | добавить `{href, label, minRole}` |
| Metrics | `getArbibotMetricsRegistry()` + `registers: []` | naming `arb_<area>_*` |
| Worker | `OnModuleInit`/`OnModuleDestroy` + `setInterval(...).unref()` + `isRunning` guard | mirror `paper-discovery-worker.ts` |

---

> Этот документ — снимок кода на 24.07.2026. Обновлять при значимых изменениях архитектуры (новые сервисы, новые single-writer границы). Последнее обновление: auth/RBAC (раздел 14 — signed JWT вместо unsigned cookie), dependency overrides (раздел 16 — npm overrides для Dependabot fixes).
