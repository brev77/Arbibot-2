# ADR: Scanner Service — autonomous cross-DEX detector

**Status:** Accepted
**Date:** 2026-07-24
**Context:** [`docs/scanner-service-plan.md`](scanner-service-plan.md) (v4, 17 решений), [`.cursor/plans/DEVELOPMENT_PLAN-SCANNER.md`](../.cursor/plans/DEVELOPMENT_PLAN-SCANNER.md) (Phase 0, step `S0-0-ADR`)

## 1. Контекст

В Arbibot 2 **отсутствует автоматическое обнаружение cross-DEX арбитража** (подтверждено `architecture-components.md` §18: «Cross-DEX арбитраж — 0 кода», `OpportunityDetected` — мёртвый код без продюсера). Существующий `paper-discovery` (`paper-trading-service`) — single-venue bid-ask, paper-изолирован, не сравнивает цены одного инструмента между разными venue.

Нужен **независимый масштабируемый детектор cross-DEX spreads**: запустили → он ищет (buy venue A → sell venue B, same chain) → публикует opportunities → STOP. Решение live/paper принимается в существующем pipeline (оператор/риск/execution). Сканер — **режимонезависимый data-provider**.

## 2. Архитектура

```
[On-chain RPC: Arb/Base/BNB]  (RPC_SCANNER_*_URL — изолированный budget)
   │ getReserves (V2), slot0+liquidity (V3), pool.factory() (protocol mapping),
   │ volumeToken0/1 (V3 cumulative), eth_getLogs Swap (V2 short-window)
   ▼
┌─────────────────────────────────────────────────────┐
│ scanner-service (apps/scanner-service, порт 3021)    │
│  reads config-service scanner.* (TTL cache)          │
│  ├─ instance#1 {net:arbitrum, strat:2venue, 2s, on}  │  ← определение из config
│  rate limiter (token bucket)                         │
│  pool-cache (in-memory per venue × token, TTL)       │
│  per cycle: read → spread → volume → filter → dedup  │
│           → WRITE findings+instances → POST /opp     │
└──────────────────────────────────────────────────────┘
   │ POST /opportunities (signedFetch, rich payload)
   ▼
[opportunity-service] create() → arbitrage_opportunities (state=detected)
   + writes OpportunityDetected outbox (Phase 3b)
   → STOP (оператор/automation драйвит дальше)
```

### Компоненты

| Компонент | Расположение | Роль |
|-----------|--------------|------|
| scanner-service | `apps/scanner-service/` (NEW, порт 3021) | Детектор cross-DEX spreads, single-writer `scanner_instances`/`scanner_findings` |
| config-service | `apps/config-service/` (existing, 3019) | Single-writer `scanner.*` конфигурации (instances, filters, enabled) |
| opportunity-service | `apps/opportunity-service/` (existing, 3010) | Single-writer `arbitrage_opportunities`; Phase 3b добавляет `OpportunityDetected` outbox |
| canonical-market-service | `apps/canonical-market-service/` (existing, 3014) | Point-lookup canonical IDs (`POST /market/resolve-instrument`) |

## 3. Single-writer границы (главный инвариант)

| Данные | Single-writer | Сканер |
|---|---|---|
| `scanner_instances` (runtime status) | **scanner-service** | пишет (upsert each cycle) |
| `scanner_findings` (cross-venue deals) | **scanner-service** | пишет |
| `scanner.*` config (instances, filters, enabled) | **config-service** | только читает (TTL cache) |
| `arbitrage_opportunities` | opportunity-service | только через `POST /opportunities` |
| `market_snapshots`, `risk_decisions`, `paper_*`, `execution_*`, `capital_*` | resp. сервисы | НЕ трогает |
| `OpportunityDetected` outbox event | opportunity-service (Phase 3b) | — (scanner только producer данных через POST) |

**scanner_instances — runtime-only** (без config-полей, без `enabled`): `instance_id`, `last_run_at`, `last_error`, `status[idle|running|error]`, `cycles_total`, `findings_total`, `opportunities_published_total`, `last_cycle_latency_ms`. Конфигурация (networks, strategies, intervals, filters, enabled) — исключительно в config-service `scanner.*`.

## 4. RPC rate budget

**Проблема:** execution-orchestrator уже использует публичные RPC (`RPC_*_URL`) с health-checks + pool reads + mempool monitor. Бесплатные RPC (arb1.arbitrum.io, mainnet.base.org) — rate limit ~50 req/min. Сканер с N инстансов × pool reads удвоит нагрузку → риск 429.

**Решение:**
- Изолированный env namespace `RPC_SCANNER_{CHAIN}_URL` (fallback `RPC_*_URL`).
- Клиентский rate limiter (token bucket, `SCANNER_RPC_RATE_LIMIT_RPS`, default conservative).
- В prod — сканер и execution-оркестратор бьют по разным endpoints.
- Aggressive in-memory pool-кэш (TTL, staggered refresh per instance) минимизирует RPC calls.

## 5. Volume (V3 cumulative vs V2 eth_getLogs)

**V3 пулы:** `volumeToken0()`/`volumeToken1()` — cumulative, single-call (дёшево). Собственный ABI `UNI_V3_POOL_SCANNER_ABI` (существующий pool-discovery ABI этих функций не содержит). Mainnet-canonical UniV3 pools only (Arb/Base/BNB); форки могут revert → graceful skip (volume=unknown → skip volume filter).

**V2 пулы (UniV2/Sushi/PancakeV2/Biswap):** НЕ имеют cumulative volume (только reserves). Real traded volume требует `eth_getLogs` по `Swap` event topic. Для MVP — **short-window only** (1h, bounded ~14,400 блоков на Arbitrum). 24h V2 full-range eth_getLogs — non-goal (10–30s multi-MB response, неприменим для цикла 2–5s).

**Swap event topic0** — V2 и V3 разные signatures → разные topic0:
- V2-family: `Swap(address,uint256,uint256,uint256,uint256,address)` → compute via `ethers.id()`
- V3-family: `Swap(address,address,int256,int256,uint160,uint128,int24)` → compute via `ethers.id()`
- **НЕ hardcode hex** — вычислять из ABI фрагмента (аудитопригодность, соответствие `@arbibot/contracts-eth`).

**Volume filter дефолт OFF** (`filters.volumeRange.enabled=false`); opt-in.

## 6. Pipeline contract — OpportunityDetected payload

`OpportunityDetected` сегодня — мёртвый код (`events.ts:21` в `EVENT_NAMES`, без payload-схемы, без продюсера). Phase 3b оживляет:

```typescript
OpportunityDetectedPayloadV1 = {
  opportunityId: string,
  instrumentKey: string,
  routeKey: string,
  sourceModule: string,        // 'scanner-service' для scanner-originated
  spreadBps: number,
  grossProfitUsd: number,
  netProfitUsd: number,
  feesUsd: number,
  volumeUsd: number | null,
  buyVenue: string,
  sellVenue: string,
  chainId: number,
  token: string,
  quoteAsset: string,
  evidence: Record<string, unknown>,
}
```

`schema_version = 1`, `source_module = SERVICE_IDS.opportunityService` (т.к. outbox пишет opportunity-service в `create()`, не сканер).

**⚠️ Lifecycle `detected→risk_checked` НЕ драйвится этим событием** — требует `RiskDecisionIssued` от risk-service через `request-risk-evaluation` (уже работает). `OpportunityDetected` — чисто наблюдаемость/future-consumers (Hermes, UI async, future auto-enricher). Сегодня 0 consumers, но контракт зафиксирован для будущих.

## 7. Graceful degradation

При недоступности opportunity-service: findings НЕ теряются.
- Retry: 3 attempts, exponential backoff (1s, 2s, 4s).
- On terminal failure: `scanner_findings.publish_status='failed'`, `opportunity_id=NULL`.
- Orphan retry worker (max 5 cumulative attempts), затем manual `POST /scanner/findings/:id/re-publish`.
- Metric `arb_scanner_opportunity_publish_failed_total{instance,reason}`.

## 8. Paper/live isolation

Scanner-service:
- НЕ импортирует `@arbibot/paper-trading-service`, paper-модули.
- НЕ импортирует wallet/key path (`WalletManagerService`, `KeyVaultService`, `getEncryptedKey`, `decryptPrivateKey`).
- RPC provider — **read-only** (без wallet, без sign).
- Взаимодействие с другими сервисами — только через HTTP (`signedFetch`).

CI gate: `ci-paper-live-boundary.sh` расширяется симметричными правилами PL.3 (scanner не импортирует paper) + PL.4 (paper не импортирует scanner).

## 9. Non-goals (первая итерация)

- Cross-chain bridge arb, triangular/cyclic arb (Phase 2+ стратегии).
- Автодрайв pipeline за пределами POST /opportunities.
- Factory-enumeration pool discovery (UniV2Factory.allPairs) — pool universe = whitelist.
- Live trading logic (сканер — data-provider).
- Дублирование EO `PoolDiscoveryService` / `PriceOracleService`.
- 24h V2 volume через full-range eth_getLogs.
- Fix `getMetrics()` mock в opportunity-service (не responsibility сканера).

## 10. Ссылки

- [`docs/scanner-service-plan.md`](scanner-service-plan.md) — полный план (17 решений, 5 раундов ревью).
- [`docs/architecture-components.md`](architecture-components.md) §1, §18 — canonical карта + пробелы.
- [`docs/scanner-harness-runbook.md`](scanner-harness-runbook.md) — процессы проверки.
- [`docs/review-gate-scanner.md`](review-gate-scanner.md) — review-gate чеклист.

---
*v1.0 — 2026-07-24*
