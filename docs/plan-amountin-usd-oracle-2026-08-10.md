# План PLAN12 — amountIn USD oracle (capital-safety фикс)

> **Назначение:** план закрытия capital-safety бага в `TokenResolverService.computeAmountIns`
> (opportunity-service), который генерировал катастрофические `amountIn` для WETH-quoted пар.
> Сформирован в формате [`docs/roadmap-vectors.md`](roadmap-vectors.md): те же поля инициатив,
> тот же жизненный цикл, те же принципы P1–P5.
>
> **Связанные документы:**
> - Стратегический каркас — [`docs/roadmap-vectors.md`](roadmap-vectors.md) (векторы, принципы).
> - Канон статусов/`step_id` — [`.cursor/plans/DEVELOPMENT_PLAN.md`](../.cursor/plans/DEVELOPMENT_PLAN.md).
> - Предыдущий план — [`docs/plan-hermes-live-correctness-2026-08-06.md`](plan-hermes-live-correctness-2026-08-06.md).
>
> **Эта документация — живая.** Все `file:line` верифицированы чтением кода на дату составления.

---

## 1. Контекст

`TokenResolverService` (PLAN10 P10-3, opportunity-service) преобразует scanner opportunity
в `CreateMultiLegPlanDto`: резолвит адреса токенов из `instrumentKey` и вычисляет pre-quoted
`amountIn` значения для buy/sell legs (Модель #1). Функция `computeAmountIns` содержала
**фундаментальный баг** в формуле конверсии `notionalUsd` → raw token units.

### Баг (подтверждён кодом + production-данными)

`apps/opportunity-service/src/opportunities/token-resolver.service.ts:266-286` (до фикса):

```typescript
// БАГ: предполагает что 1 единица token1 = $1 (только для стейблкоинов)
const buyAmountIn = BigInt(Math.round(notionalUsd * 10 ** tokens.decimals1)).toString();
const expectedBase = notionalUsd / buyPrice;
```

Комментарий на line 274 сам признавал допущение: *"we assume the quote is the stablecoin leg"*.
Это допущение молча нарушалось для любой пары, где token1 ≠ USDC/USDT/DAI.

**Production-доказательство:** сканер нашёл CRV/WETH пару с `buyPrice=0.000122 WETH/CRV`.
При `LIVE_NOTIONAL_USD=50`:
- `token1 = WETH` (18 decimals)
- Баг: `buyAmountIn = 50 × 10^18 = 50000000000000000000` = **50 WETH ≈ $130000**
- Должно быть: `50 / $2600 = 0.0192 WETH ≈ $50`

Это **capital-safety RED-zone**: бот может сгенерировать swap на десятки WETH при заявленном
$50 notional. То, что pipeline сейчас блокируется на DEX risk gate (dead-pool slippage) —
единственное, что предотвращает реальный loss.

### Почему баг не был пойман тестами

`token-resolver.service.spec.ts` (до фикса) тестировал только stable-quoted пары:
`WETH-USDC` (token1=USDC) и `MAGIC-USDC` (token1=USDC). Для стейблкоинов баг-формула случайно
верна: `10 × 10^6 = 10_000_000` = 10 USDC = $10. Ни один тест не покрывал non-stable quote
(например `CRV-WETH`), поэтому регрессия не поймалась.

---

## 2. Принципы (наследуются из roadmap-vectors.md)

Соблюдаем P1–P5 из [`docs/roadmap-vectors.md`](roadmap-vectors.md) §1 без изменений.
Ключевые для этого плана:

- **P1 — Код-источник-истины:** root cause и формула верифицированы чтением
  `token-resolver.service.ts` + `scanner-spread.service.ts` (семантика `buyPrice`).
- **P4 — Приоритет live-blocker:** `capital-safety RED-zone` — идёт вне очереди.

Дополнительно — **специфичный для этого плана принцип:**

### P-AMT-1. Defense-in-depth: oracle primary + fail-closed

> Цена quote-токена нужна для корректного `amountIn`. Первичный path — USD price oracle
> (существующий `PriceOracleService` в EO). Страховка — fail-closed: если oracle недоступен
> или не может цену вернуть, `computeAmountIns` возвращает null → worker skip'аетopp
> (метрика `skip_no_price`). Никогда не возвращаться к формуле `notionalUsd × 10^decimals`.

Это ровно та же философия что в live-gate (kill-switch primary + `DEX_VENUE_ENABLED`
fail-closed), KeyVault (AES primary + `VAULT_MASTER_KEY_SALT` assert), и остальных RED-zone
gated flows. Принцип P-AMT-1 — часть DoD.

---

## 3. Реестр инициатив

> Порядок — по `gate` (live-blocker первыми), затем по `score` (убывание).
> Продолжение нумерации `roadmap-vectors.md` (инициативы #1–#47 — там).

| # | step_id | Вектор(ы) | gate | tracker | impact | effort | score | status | plan |
|---|---------|-----------|------|---------|--------|--------|-------|--------|------|
| 48 | `FUNC-AMOUNTIN-USD-ORACLE` | FUNC (SEC) | **live-blocker** | new | 5 | 2 | 20 | done | PLAN12 |

### Легенда

- **gate:** `live-blocker` — блокирует live-деплой (capital-safety RED-zone).
- **score:** `impact × (6 − effort)`, диапазон 5–25.
- **status:** `proposed` → `accepted` → `in-progress` → `review` → `done`.

### Порядок исполнения

Одна инициатива, три компонента (EO endpoint + opp-service client + формула-фикс), все
зависимы друг от друга — идут одним коммитом.

---

## 4. Детализация инициатив

### #48. `FUNC-AMOUNTIN-USD-ORACLE` — amountIn USD oracle

| Поле | Значение |
|------|----------|
| **Вектор** | `FUNC` (торговое преимущество), вторичный `SEC` (capital safety) |
| **gate** | `live-blocker` |
| **impact / effort / score** | 5 / 2 / 20 |
| **Корневые файлы** | `apps/opportunity-service/src/opportunities/token-resolver.service.ts:266-286` (баг), `apps/execution-orchestrator/src/execution/price/price-oracle.service.ts` (существующий oracle, reuse) |

#### Проблема (подтверждено кодом)

Подробности — §1 выше. Кратко: `computeAmountIns` делает `notionalUsd × 10^decimals1`, что
верно только если 1 единица token1 = $1 (стейблкоин). Для WETH-quoted пар это генерирует
десятки WETH вместо доли WETH.

Дополнительная находка: `expectedBase = notionalUsd / buyPrice` — тоже неверна, потому что
`buyPrice` (из сканера, `quotePerBase`) выражен в quote-token human units, а не в USD. Обе
формулы (buyAmountIn и sellAmountIn) расходятся с реальностью одновременно для non-stable quote.

Фундаментальная нехватка данных: сканер в `evidence` кладёт только `buyPrice`/`sellPrice`
(отношение quote↔base), **не кладёт USD-цену**. Поэтому `computeAmountIns` физически не может
конвертировать `notionalUsd` в quote-token units без внешнего price feed.

#### Решение: вариант 2 (price oracle) + вариант 1 (fail-closed)

`PriceOracleService` уже существует в execution-orchestrator (`price-oracle.service.ts`) и
умеет ровно то, что нужно — 3-tier resolution:

| Tier | Токен | Цена | Источник |
|------|-------|------|----------|
| 1 | USDC/USDT/DAI | $1 | хардкод (ADR live-gate §2) |
| 2 | WETH/WBNB | Chainlink | `AggregatorV3.latestRoundData()` |
| 3 | Любой long-tail (MAGIC, CRV, GMX…) | pool-derived | token↔WETH пул → цена в WETH × WETH/USD |

В нём уже есть кэш (TTL 60s), single-flight, fail-closed (null → никогда не бросает), метрики.

**Исправленная формула** (backward-compatible для стейблкоинов где `quoteUsd=1`):

```typescript
const quoteAmount = notionalUsd / quoteUsd;      // USD → quote-token human units
const buyAmountIn  = BigInt(Math.round(quoteAmount * 10 ** decimals1)).toString();
const expectedBase = quoteAmount / buyPrice;     // quote → base human units
const sellAmountIn = BigInt(Math.round(expectedBase * 10 ** decimals0)).toString();
```

#### Шаги реализации

1. **EO `PriceController`** — read-only endpoint `GET /execution/price/:chainId/:tokenAddress`
   делегирует к существующему `PriceOracleService.getTokenPriceUsd()`. Без guards (паттерн
   `DexHealthController`). `ParseIntPipe` для chainId (первый numeric-param в EO). Response
   `{ chainId, tokenAddress, priceUsd }` — HTTP 200 даже при `priceUsd=null` (fail-closed).

2. **Opp-service `LivePriceClientService`** — non-throwing HTTP-клиент (returns null on any
   failure), `signedFetch` (HMAC service-auth), 5s timeout. Reuse `EXECUTION_API_BASE` env.
   Паттерн `RiskClientService.getRiskDecision`.

3. **`TokenResolverService` split + фикс** — `resolve()` → `resolveTokens()` (sync, pure) +
   public `computeAmountIns(tokens, notionalUsd, evidence, quoteUsd)` (sync, новый параметр).
   Worker оркестрирует async oracle lookup между ними.

4. **`LiveAutoDriveWorker` wiring** — inject `LivePriceClientService`, 3-шаговый flow:
   `resolveTokens → livePrice.getTokenPriceUsd → computeAmountIns`. Metric label `skip_no_price`.

5. **Тесты** — WETH-quoted кейс (`CRV-WETH`, $50 → 0.019 WETH вместо 50 WETH), stable-quoted
   backward-compat, fail-closed (quoteUsd=0/null → null).

#### DoD

- [x] EO `PriceController` + spec — `GET /execution/price/:chainId/:tokenAddress` делегирует
      к `PriceOracleService`.
- [x] Opp-service `LivePriceClientService` + spec — non-throwing HTTP-клиент.
- [x] `TokenResolverService` — `resolveTokens()` (sync) + `computeAmountIns(tokens, notional,
      evidence, quoteUsd)` (sync, формула исправлена).
- [x] `LiveAutoDriveWorker` — inject `LivePriceClientService`, 3-шаговый flow, metric label
      `skip_no_price`.
- [x] Spec: WETH-quoted кейс (0.019 WETH вместо 50 WETH), stable-quoted backward-compat,
      fail-closed (quoteUsd=0→null).
- [x] Build: EO + opportunity-service green.
- [x] Tests: EO price-controller spec (4/4), opp-service token-resolver spec (23/23) +
      live-price-client spec (13/13) + worker spec (14/14) green.
- [x] `docs/roadmap-vectors.md` — инициатива #48 → `done`.

---

## 5. Жизненный цикл

`proposed` (2026-08-10, сформирован из анализа кода) → `done` (2026-08-10, реализован,
тесты зелёные).

---

## 6. Метрики

- **`arb_live_auto_drive_plans_created_total{outcome="skip_no_price"}`** — NEW label: worker
  skip'ает opp когда oracle недоступен или не может цену вернуть. Целевое значение в normal
  operation: 0 (если oracle настроен). Рост → проблема с EO/RPC/Chainlink feed.
- **`arb_price_oracle_lookup_total{result="hit|miss|failed"}`** — REUSE существующей метрики
  EO. opp-service не вводит свою — цена проходит через EO endpoint, который уже инструментирован.

---

## 7. Anti-patterns (чего избегать)

- ❌ **Возвращаться к `notionalUsd × 10^decimals` при oracle-down.** Это ровно тот баг, который
  PLAN12 чинит. Fail-closed (skip) — единственно допустимое поведение (принцип P-AMT-1).
- ❌ **Дублировать `PriceOracleService` в opportunity-service.** Oracle уже существует в EO с
  кэшем, single-flight, метриками. Вынос в shared-пакет = большее изменение (прибят к
  `RpcProviderManager`/`PoolDiscoveryService`); для MVP acceptable HTTP round-trip.
- ❌ **Кэшировать цену в opp-service.** EO уже кэширует 60s; для MVP single-chain с ~1 opp/min
  это избыточно. Введение кэша = новая точка рассинхронизации.

---

## 8. Что план НЕ покрывает

PLAN12 чинит **только** расчёт `amountIn` (USD→quote-token конверсия). Он НЕ решает:

1. **Dead-pool slippage блокер** — мёртвые SushiSwap пулы дают 9998 bps slippage в EO cost-gate.
   Это **отдельная подсистема**: scanner-side dead-pool фильтр (`minPoolLiquidityUsd`,
   `scanner-spread.service.ts:142-171`) уже существует, но его эффективность — отдельное
   расследование. После PLAN12 бот всё ещё может находить спреды на мёртвых пулах, но amountIn
   будет рассчитан корректно. **Нужны оба фикса: PLAN12 (correctness) + liquidity-filter.**
2. **Cross-chain (мосты)** — отдельный план.
3. **Long-tail токены без WETH-пула** (tier-3 oracle возвращает null → `skip_no_price` — pipeline
   skip'ает, не теряет капитал; целевое fail-closed поведение).
4. **Opp-service cache** (EO уже кэширует 60s; для MVP single-chain с ~1 opp/min избыточно).
5. **amountIn = Модель #1 pre-quoted** (sell amountIn = ожидаемый buy amountOut; reverted sell
   → stuck-plan-reaper) — существующий documented risk, не scope этого фикса.

---

## 9. Результат выполнения

Все шаги реализованы в одном коммите (2026-08-10):

**EO:**
- `apps/execution-orchestrator/src/execution/price/price.controller.ts` (новый) —
  `GET /execution/price/:chainId/:tokenAddress`, делегирует к `PriceOracleService.getTokenPriceUsd`,
  `ParseIntPipe` для chainId, lowercase-нормализация tokenAddress в response.
- `apps/execution-orchestrator/src/execution/price/price.controller.spec.ts` (новый) — 4 теста
  (delegation, null pass-through, lowercase, long-tail).
- `apps/execution-orchestrator/src/execution/execution.module.ts` — `PriceController` в `controllers[]`.

**opportunity-service:**
- `apps/opportunity-service/src/opportunities/live-price-client.service.ts` (новый) — non-throwing
  HTTP-клиент, `signedFetch`, 5s timeout, `EXECUTION_API_BASE` reuse.
- `apps/opportunity-service/src/opportunities/live-price-client.service.spec.ts` (новый) — 13 тестов
  (success, null-price, network error, timeout, non-OK, non-JSON, missing field, zero/negative,
  default URL, trailing slash).
- `apps/opportunity-service/src/opportunities/token-resolver.service.ts` — split `resolve()` →
  `resolveTokens()` (sync) + public `computeAmountIns(tokens, notional, evidence, quoteUsd)` (sync);
  исправлена формула (`quoteAmount = notionalUsd / quoteUsd`); обновлён docstring; удалён
  `ResolveResult` интерфейс.
- `apps/opportunity-service/src/opportunities/token-resolver.service.spec.ts` — переписан под новый
  API; 23 теста включая WETH-quoted кейс (0.019 WETH вместо 50 WETH) + fail-closed guards.
- `apps/opportunity-service/src/opportunities/live-auto-drive.worker.ts` — inject
  `LivePriceClientService`; 3-шаговый flow (`resolveTokens → getTokenPriceUsd → computeAmountIns`);
  metric label `skip_no_price`.
- `apps/opportunity-service/src/opportunities/live-auto-drive.worker.spec.ts` — обновлён под новый
  constructor (8 args) + API; 14 тестов включая 2 новых `skip_no_price`.
- `apps/opportunity-service/src/opportunities/opportunities.module.ts` — `LivePriceClientService`
  в `providers[]`.

**Сверка (на коммите после правок):**
- Build: execution-orchestrator ✅, opportunity-service ✅.
- Tests: execution-orchestrator 869/869 ✅ (55 suites, +1 new), opportunity-service 201/201 ✅
  (14 suites, +1 new suite, +36 new tests total).
- Lint: opportunity-service 0 errors ✅; execution-orchestrator 0 errors (7 pre-existing warnings,
  none in PLAN12 files).

**Capital-safety валидация:** WETH-quoted кейс (`CRV-WETH`, $50 @ $2600/WETH, buyPrice=0.000122)
— `buyAmountIn = 19230769230769232` = 0.0192 WETH ≈ $50 (вместо багового 50 WETH ≈ $130000).
Тест `token-resolver.service.spec.ts` фиксирует это число.

---

*Составлено: 2026-08-10 на основе анализа кода `token-resolver.service.ts:266-286` +
`scanner-spread.service.ts` (семантика `buyPrice`/`quotePerBase`) + `price-oracle.service.ts`
(3-tier resolution). Все `file:line` верифицированы прямым чтением кода. Реализовано, проверено
локально (build/test зелёные). При изменении кода — обновить этот файл по принципу P2.*
