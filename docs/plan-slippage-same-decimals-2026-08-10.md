# План PLAN13 — slippage gate same-decimals фикс

> **Назначение:** план закрытия live-blocker бага в `enforcePostQuoteSlippageGate`
> (execution-orchestrator), который блокировал каждый валидный cross-token арб с одинаковыми
> decimals. Сформирован на основе ТЗ Hermes Agent от 2026-08-10, верифицирован факт-чеком
> кода + воспроизведением математики.
>
> **Связанные документы:**
> - ТЗ Hermes — `docs/tz-slippage-decimals.md` (архив).
> - Стратегический каркас — [`docs/roadmap-vectors.md`](roadmap-vectors.md) (векторы, принципы).
> - Предыдущий план — [`docs/plan-amountin-usd-oracle-2026-08-10.md`](plan-amountin-usd-oracle-2026-08-10.md).
>
> **Эта документация — живая.** Все `file:line` верифицированы чтением кода на дату составления.

---

## 1. Контекст

`enforcePostQuoteSlippageGate` (P9-5) — live gate, который проверяет реальный price impact
свопа после on-chain quote и блокирует исполнение при превышении `maxSlippageBps`. Функция
живёт в `apps/execution-orchestrator/src/execution/adapters/uniswap-v2.adapter.ts:389` и
вызывается из **5 адаптеров**: UniV2, SushiV2, PancakeV2, BiswapV2, UniV3.

### Баг (подтверждён кодом + воспроизведён математически)

Строки 417-420 (до фикса):

```typescript
if (tokenInDecimals === tokenOutDecimals && amountInUnits > 0) {
  // Same decimals → direct ratio is exact.
  impactBps = Math.round(((amountInUnits - expectedOutUnits) / amountInUnits) * 10000);
}
```

Комментарий «Same decimals → direct ratio is exact» — **математически неверен**. Одинаковые
decimals не означают одинаковую ценность: CRV (18 decimals) и WETH (18 decimals) имеют
одинаковую разрядность, но разные цены.

**Production-доказательство** (CRV/WETH sell leg):

```
amountIn  = 42928716850243592192   → 42.92 CRV (18 dec) ≈ $9.87  (@ $0.23/CRV)
expectedOut = 5467890176566390     → 0.005467 WETH (18 dec) ≈ $10.39 (@ $1900/WETH)
```

Сделка **прибыльна** ($10.39 > $9.87). Но баг-формула считает:

```
(42.92 - 0.005467) / 42.92 × 10000 = 9999 bps → BLOCKED (> 50 max)
```

Правильный расчёт (USD compare):

```
($9.87 - $10.39) / $9.87 × 10000 = -527 bps → clamped to 0 → PASSED
```

Воспроизведено в Node.js — цифры совпадают до бита.

### Почему баг выжил P9-5 тесты

Тесты (`uniswap-v2.adapter.spec.ts:719-741`) использовали **одинаковые цены** для tokenIn
и tokenOut (`inUsd: 2500, outUsd: 2500`). То есть тестировали WETH→WETH, где same-decimals
coincidentally работает. Ни один тест не проверял **разные цены при одинаковых decimals**
(CRV→WETH) — классический test gap.

---

## 2. Принципы (наследуются из roadmap-vectors.md)

Соблюдаем P1–P5 из [`docs/roadmap-vectors.md`](roadmap-vectors.md) §1 без изменений.
Ключевые для этого плана:

- **P1 — Код-источник-истины:** баг воспроизведён математически + верифицирован чтением
  `uniswap-v2.adapter.ts:417-420` + `price-oracle.service.ts` (decimals CRV/WETH).
- **P4 — Приоритет live-blocker:** баг блокирует **все** валидные cross-token арбы с
  одинаковыми decimals (CRV/WETH, MAGIC/USDC при 6/6, и т.д.).

---

## 3. Реестр инициатив

| # | step_id | Вектор(ы) | gate | tracker | impact | effort | score | status | plan |
|---|---------|-----------|------|---------|--------|--------|-------|--------|------|
| 49 | `SEC-SLIPPAGE-SAME-DECIMALS` | SEC (FUNC) | **live-blocker** | new | 5 | 1 | 25 | done | PLAN13 |
| 50 | `SEC-APPROVE-AFTER-GATE` | SEC (FUNC) | **live-blocker** | new | 4 | 1 | 20 | done | PLAN13 |
| 51 | `FUNC-WRAP-NATIVE-BEFORE-SWAP` | FUNC (SEC) | **live-blocker** | new | 5 | 2 | 20 | done | PLAN13 |

### Легенда

- **gate:** `live-blocker` — блокирует live-сделки (false-negative gate: блокирует валидные арбы).
- **score:** `impact × (6 − effort)` = 5 × 5 = 25 (максимум).
- **status:** `proposed` → `done`.

---

## 4. Детализация инициативы

### #49. `SEC-SLIPPAGE-SAME-DECIMALS` — slippage gate same-decimals фикс

| Поле | Значение |
|------|----------|
| **Вектор** | `SEC` (capital safety — gate correctness), вторичный `FUNC` (торговое преимущество) |
| **gate** | `live-blocker` |
| **impact / effort / score** | 5 / 1 / 25 |
| **Корневой файл** | `apps/execution-orchestrator/src/execution/adapters/uniswap-v2.adapter.ts:417-420` (функция `enforcePostQuoteSlippageGate`, вызывается из 5 адаптеров) |

#### Решение

Удалить ветку «same decimals → direct ratio». Всегда сравнивать в USD:

```typescript
const tokenInUsd = await priceOracle.getTokenPriceUsd(chainId, tokenIn);
const tokenOutUsd = await priceOracle.getTokenPriceUsd(chainId, tokenOut);
if (tokenInUsd === null || tokenOutUsd === null || amountInUnits <= 0) {
  throw new VenueSubmitClientError(
    `${adapterName}: cannot price tokens for slippage check ...`,
    { category: 'semantic' },
  );
}
const notionalInUsd = amountInUnits * tokenInUsd;
const notionalOutUsd = expectedOutUnits * tokenOutUsd;
let impactBps = Math.round(((notionalInUsd - notionalOutUsd) / notionalInUsd) * 10000);
```

**Производительность:** теперь каждый gate-вызов делает 2 `getTokenPriceUsd` (раньше только
different-decimals ветка). Но oracle кэширует 60s + single-flight — для hot path незаметно.

**Сообщение об ошибке** обновлено: убрано «cross-decimals» (теперь всегда USD, не зависит от
decimals). Текст: `cannot price tokens for slippage check (tokenIn=..., tokenOut=...)`.

#### Шаги реализации

1. **Фикс** `uniswap-v2.adapter.ts:417-434` — убрать `if/else`, всегда USD compare. Функция
   общая для 5 адаптеров — фикс в одном месте чинит все.
2. **Тесты** `uniswap-v2.adapter.spec.ts` — обновить regex ошибки (`cross-decimals` →
   `slippage check`); добавить CRV/WETH кейс (passes, impact 0) и CRV/WETH с real loss
   (blocks).

#### DoD

- [x] `enforcePostQuoteSlippageGate` всегда использует USD-сравнение (нет ветки «same decimals»).
- [x] Тест CRV/WETH (равные decimals, разная цена, profitable) — passes (impact 0).
- [x] Тест CRV/WETH (real loss) — blocks.
- [x] Build/lint/test EO green (871/871, 55 suites).
- [x] `docs/roadmap-vectors.md` — инициатива #49 → `done`.

### #50. `SEC-APPROVE-AFTER-GATE` — approve после slippage gate

| Поле | Значение |
|------|----------|
| **Вектор** | `SEC` (capital safety — gas leak), вторичный `FUNC` |
| **gate** | `live-blocker` |
| **impact / effort / score** | 4 / 1 / 20 |
| **Корневые файлы** | `apps/execution-orchestrator/src/execution/adapters/{uniswap-v2,sushiswap-v2,pancakeswap-v2,biswap-v2,uniswap-v3}.adapter.ts` (5 адаптеров) |

#### Проблема (подтверждено кодом)

Во всех 5 DEX-адаптерах порядок шагов `submitLeg` был:

```
3. selectWallet
4. ensureApproval    ← broadcast ERC20 approve tx (тратит gas)
5. calculateAmountOutMin (quote — read-only view call, gas-free)
6. enforcePostQuoteSlippageGate  ← блокирует если price impact > max
7. broadcast swap tx
```

Если gate блокирует (step 6), approve (step 4) **уже выполнен** — gas потрачен впустую.
Каждый failed-at-gate attempt терял ~$0.015 на approve. Hermes наблюдал падение ETH
баланса: `0.005824 → 0.005816 ETH` за серию failed attempts.

#### Решение

Переставить quote + gate **перед** approve во всех 5 адаптерах:

```
3. selectWallet
4. calculateAmountOutMin (quote — read-only, gas-free)
5. enforcePostQuoteSlippageGate  ← блокирует ДО approve → gas не тратится
6. ensureApproval    ← только если gate прошёл
7. broadcast swap tx
```

Quote (`getAmountsOut` для V2 / `QuoterV2.quoteExactInputSingle` для V3) — это read-only
view call, не требует allowance и не тратит gas. Перестановка безопасна.

#### DoD

- [x] Все 5 адаптеров (UniV2, SushiV2, PancakeV2, BiswapV2, UniV3) выполняют quote+gate
      до approve.
- [x] Build/lint/test EO green (871/871, 55 suites — моки шагов не завязаны на порядок).
- [x] `docs/roadmap-vectors.md` — инициатива #50 → `done`.

### #51. `FUNC-WRAP-NATIVE-BEFORE-SWAP` — native wrap перед swap

| Поле | Значение |
|------|----------|
| **Вектор** | `FUNC` (live execution), вторичный `SEC` (capital safety) |
| **gate** | `live-blocker` |
| **impact / effort / score** | 5 / 2 / 20 |
| **Корневые файлы** | `apps/execution-orchestrator/src/execution/adapters/native-wrap.ts` (новый), `apps/execution-orchestrator/src/execution/adapters/{uniswap-v2,sushiswap-v2,pancakeswap-v2,biswap-v2,uniswap-v3}.adapter.ts` |

#### Проблема (подтверждено on-chain read)

Кошелёк `0xDea3…46f3` содержит **0.0058 ETH, но 0 WETH**. DEX routers работают с ERC20
(`swapExactTokensForTokens` → `transferFrom`), поэтому swap где `tokenIn=WETH` падает с
`TransferHelper: TRANSFER_FROM_FAILED` — router не может списать WETH, которого нет на балансе.

Это блокирует каждый arb где quote-token = WETH (CRV/WETH, MAGIC/WETH, UNI/WETH и т.д.) —
большинство пар на Arbitrum.

#### Решение

Создан `ensureWrappedNativeBalance()` (`native-wrap.ts`) — вызывается перед `ensureApproval`
в каждом из 5 адаптеров. Если `tokenIn` = wrapped native (WETH/WBNB) и баланс ниже `amountIn`,
отправляет `WETH.deposit({value: shortfall})` (wrap ETH → WETH 1:1). Idempotent: если баланс
уже достаточен (например WETH получен с предыдущего buy leg) — no-op.

**Resilience:** если `balanceOf` падает (RPC down, mock wallet без provider), helper логирует
warn и продолжает — swap сам упадёт с понятной ошибкой если WETH действительно нужен.

#### DoD

- [x] `ensureWrappedNativeBalance` создан, вызывается перед approve во всех 5 адаптерах.
- [x] Unit-тесты: no-op для non-native tokenIn, no-op при достаточном балансе, wrap shortfall,
      partial balance, revert handling (5 тестов).
- [x] Build/lint/test EO green (876/876, 56 suites).
- [x] `docs/roadmap-vectors.md` — инициатива #51 → `done`.

---

## 5. Жизненный цикл

`proposed` (2026-08-10, ТЗ Hermes) → `done` (2026-08-10, реализован, тесты зелёные).

---

## 6. Что план НЕ покрывает

- Backlog из 8175 исторических failed-планов (PLAN12 era) — это отдельная задача очистки БД.
- Дедупликация `execution_plans` (unique constraint на `route_key, correlation_id`) — отдельная
  инициатива.

---

## 7. Результат выполнения

**Файл:** `apps/execution-orchestrator/src/execution/adapters/uniswap-v2.adapter.ts:417-434`
— ветка «same decimals» удалена, всегда USD compare.

**Тесты:** `uniswap-v2.adapter.spec.ts` — 36/36 (было 34, +2 CRV/WETH кейса); regex ошибки
обновлён. Полный EO suite: 871/871 (55 suites).

**Capital-safety валидация:** CRV/WETH arb (42.92 CRV → 0.005467 WETH) — impact **0 bps**
(was 9999). Pipeline больше не блокируется на валидных cross-token арбах с одинаковыми decimals.

---

*Составлено: 2026-08-10 на основе ТЗ Hermes + факт-чека кода (`uniswap-v2.adapter.ts:417-420`)
+ воспроизведения математики в Node.js. Все цифры верифицированы. Реализовано, проверено
локально (build/test зелёные). При изменении кода — обновить этот файл по принципу P2.*
