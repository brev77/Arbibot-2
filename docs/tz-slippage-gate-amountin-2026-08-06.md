# ТЗ: Slippage gate блокирует — pre-quoted sell amountIn рассчитан неверно

> **Источник:** `/root/tz-slippage-gate-amountin.md` на хосте `arbibot-paper`.
> **Архивировано:** 2026-08-09 (PLAN12 #4) — дословная копия серверного ТЗ + раздел
> сверки ZCode в конце. **Гипотеза ТЗ «`expectedOut=1729` пересчитывается в адаптере» —
> ОПРОВЕРГНУТА** сверкой кода + данных БД + логов (см. раздел сверки).

**Дата:** 6 августа 2026
**Автор:** Hermes Agent
**Приоритет:** 🔴 CRITICAL — блокирует все live-сделки
**Коммит:** `8da84f3`
**Контекст:** Pipeline доходит до `approval_confirmed` → `amount_out_min` → `enforcePostQuoteSlippageGate` → BLOCKED

---

## Проблема

SushiSwap sell leg блокируется slippage gate:

```
live slippage gate blocked — real price impact 9998 bps exceeds max 50 bps
(amountIn=253126107426719989760 expectedOut=1729 on chain 42161)
```

**Разбор значений:**
- `amountIn=253126107426719989760` — sell leg input (MAGIC, 18 decimals)
- В human units: 253126107426719989760 / 10^18 = **253.1 MAGIC**
- `expectedOut=1729` — sell leg expected output (USDC, 6 decimals)
- В human units: 1729 / 10^6 = **$0.001729**
- **Цена MAGIC при продаже:** $0.001729 / 253.1 = **$0.0000068** (реальная цена ~$0.04)

**Расхождение:** sell amountIn = 253 MAGIC, но при цене $0.04 это должно дать $10.12 USDC (10,120,000), а не $0.0017 (1,729).

**Это несоответствие единиц:** `expectedOut=1729` рассчитан как `amountOutMin` от **buy leg's** `amountOutExpected`, но в **неправильных decimals**.

---

## Корневая причина (на основе кода)

### Файл: `apps/opportunity-service/src/opportunities/token-resolver.service.ts`

**Строки 266-286** — `computeAmountIns()`:

```typescript
private computeAmountIns(
  tokens: ResolvedTokens,
  notionalUsd: number,
  evidence: OpportunityEvidence | undefined,
): AmountIns | null {
  // quote token = token1 (USDC/USDT)
  const buyAmountIn = BigInt(Math.round(notionalUsd * 10 ** tokens.decimals1)).toString();

  const buyPrice = evidence?.buyPrice;  // = 0.039506 (USDC per MAGIC)

  // expected base received = notional(quote) / price(quote per base)
  const expectedBase = notionalUsd / buyPrice;
  // expectedBase = 10 / 0.039506 = 253.1 MAGIC ✅ (верно!)

  const sellAmountIn = BigInt(Math.round(expectedBase * 10 ** tokens.decimals0)).toString();
  // sellAmountIn = 253.1 * 10^18 = 253126107426719989760 ✅ (верно!)

  return { buyAmountIn, sellAmountIn };
}
```

**`sellAmountIn` рассчитан ПРАВИЛЬНО** — 253.1 MAGIC в wei.

### Файл: `apps/opportunity-service/src/opportunities/plan-setup-orchestrator.service.ts`

**Строки 132-170** — `createPlan()`:

```typescript
const buyAmountOutExpected = amountIns.sellAmountIn;  // = "253126107426719989760"
const sellAmountOutExpected = amountIns.buyAmountIn;  // = "10000000" (10 USDC)

legs: [
  {
    legType: 'dex', ...,
    tokenIn: quote (USDC), tokenOut: base (MAGIC),
    amountIn: amountIns.buyAmountIn,      // = "10000000" (10 USDC) ✅
    amountOutExpected: buyAmountOutExpected, // = "253126107426719989760" (253 MAGIC) ✅
  },
  {
    legType: 'dex', ...,
    tokenIn: base (MAGIC), tokenOut: quote (USDC),
    amountIn: amountIns.sellAmountIn,      // = "253126107426719989760" (253 MAGIC) ✅
    amountOutExpected: sellAmountOutExpected, // = "10000000" (10 USDC) ✅
  },
]
```

**amountIns рассчитаны верно!** Buy: 10 USDC → 253 MAGIC. Sell: 253 MAGIC → 10 USDC.

### Файл: `apps/execution-orchestrator/src/execution/adapters/sushiswap-v2.adapter.ts`

**Sell leg** (`tokenIn=MAGIC, tokenOut=USDC`):

```typescript
// calculateAmountOutMin для SushiSwap V2:
const amountOutMin = ...; // вызов getAmountsOut через router
const expectedAmountOut = params.amountOutExpected; // = "10000000" (10 USDC) — из plan
```

**Лог EO подтверждает:**
```
amountOutMin=1720 expectedAmountOut=1729
```

**`expectedAmountOut=1729`** — это ~$0.0017 USDC. Но plan setup передал `amountOutExpected=10000000` (10 USDC).

**Значение 1729 не совпадает с 10000000.** Оно было пересчитано внутри адаптера.

### Файл: `apps/execution-orchestrator/src/execution/adapters/uniswap-v2.adapter.ts`

Функция `calculateAmountOutMin` (строки ~400-480):

```typescript
const expectedAmountOut = params.amountOutExpected;
```

Но в логе значение `1729`. Это означает что `params.amountOutExpected` = `"1729"`, а не `"10000000"`.

**Проверка:** В `plan-setup-orchestrator.service.ts:139`:
```typescript
const sellAmountOutExpected = amountIns.buyAmountIn; // = "10000000"
```

Но в БД или в `playbookConfig.legs[1].amountOutExpected` может быть `"1729"`.

---

## Истинная причина: `extractSwapParamsV2` меняет значение

Файл `apps/execution-orchestrator/src/execution/adapters/uniswap-v2.adapter.ts`, функция `extractSwapParamsV2`:

Проверить — берёт ли она `amountOutExpected` из `playbookConfig.legs[legIndex]` или вычисляет заново.

**Возможный сценарий:**
1. `plan-setup-orchestrator` передаёт `amountOutExpected=10000000` (10 USDC) для sell leg
2. `MultiLegPlanBuilderService.buildMultiLegPlan` может **пересчитать** `amountOutExpected` при сохранении в БД
3. `extractSwapParamsV2` читает пересчитанное значение

### Альтернативная причина: buy leg не исполнился

Buy leg (UniV3) не был отправлен (revert на gas estimation). Sell leg (SushiSwap) пытается выполниться **без buy**. Slippage gate видит:
- amountIn = 253 MAGIC (которых у кошелька нет — баланс = 0)
- expectedOut = 1729 raw units (пересчитано от пула без buy)

**Но в логе SushiSwap** `approval_confirmed` — значит ERC20 approve для MAGIC прошёл, и SushiSwap router получил allowance.

---

## Решение

### Шаг 1: Добавить логирование в `extractSwapParamsV2`

**Файл:** `apps/execution-orchestrator/src/execution/adapters/uniswap-v2.adapter.ts`

Добавить debug-лог ВСЕХ swap params для sell leg:
```typescript
this.logger.debug(
  `extractSwapParamsV2: legIndex=${legIndex} tokenIn=${params.tokenIn} tokenOut=${params.tokenOut} ` +
  `amountIn=${params.amountIn} amountOutExpected=${params.amountOutExpected} ` +
  `playbookConfig.legs[${legIndex}]=${JSON.stringify(plan.playbookConfig?.legs?.[legIndex])}`
);
```

### Шаг 2: Проверить `extractSwapParamsV2` на proper decimal handling

**Файл:** `apps/execution-orchestrator/src/execution/adapters/uniswap-v2.adapter.ts`

Функция `extractSwapParamsV2` может неправильно масштабировать `amountOutExpected` между decimals.

Например, если buy leg возвращает `amountOut` в **MAGIC wei** (18 decimals), а sell leg ожидает `amountOutExpected` в **USDC units** (6 decimals) — нужен conversion:
```
amountOutExpected(USDC) = amountOut(MAGIC) * sellPrice(USDC per MAGIC) / 10^12
```

### Шаг 2 alt: Динамический `amountIn` для sell leg

**Файл:** `apps/execution-orchestrator/src/execution/adapters/sushiswap-v2.adapter.ts`

Вместо pre-quoted `sellAmountIn`, sell leg должен получить `amountIn` из **фактического результата buy leg**.

Но это требует **runtime chaining** (Модель #2 из плана P-LAD), что выходит за рамки MVP.

### Шаг 3: Для MVP — исправить pre-quoted `amountOutExpected` для sell leg

**Файл:** `apps/opportunity-service/src/opportunities/plan-setup-orchestrator.service.ts`

**Строки 138-139:**
```typescript
const buyAmountOutExpected = amountIns.sellAmountIn;  // buy: USDC→MAGIC, out = MAGIC wei ✅
const sellAmountOutExpected = amountIns.buyAmountIn;  // sell: MAGIC→USDC, out = USDC units ✅
```

Это **математически верно**, но `sellAmountOutExpected` = `"10000000"` (10 USDC = 10 * 10^6). Проверить что `extractSwapParamsV2` читает это значение правильно.

**Проверить в БД** — что реально сохранено в `playbookConfig.legs[1].amountOutExpected` для sell leg:

```sql
SELECT playbool_config->'legs'->1->>'amountOutExpected',
       playbook_config->'legs'->1->>'amountIn',
       playbook_config->'legs'->1->>'tokenIn',
       playbook_config->'legs'->1->>'tokenOut'
FROM execution_plans
WHERE created_at > '2026-08-06 16:16:00'
ORDER BY created_at DESC LIMIT 1;
```

---

## Порядок действий

1. **Проверить `playbookConfig` в БД** — какие `amountIn` и `amountOutExpected` реально сохранены для sell leg
2. **Добавить логирование** в `extractSwapParamsV2` — какой `amountOutExpected` читается
3. **Если значение в БД = `"1729"`** — проблема в `MultiLegPlanBuilderService.buildMultiLegPlan` (пересчитывает)
4. **Если значение в БД = `"10000000"`** — проблема в `extractSwapParamsV2` (читает не то поле)
5. **Исправить calculation** — sell leg должен получать корректный `amountOutExpected` в правильных decimals

---

## Ключевые файлы

| Файл | Строки | Что |
|------|--------|-----|
| `apps/opportunity-service/src/opportunities/token-resolver.service.ts` | 266-286 | `computeAmountIns` — sellAmountIn = 253 MAGIC (верно) |
| `apps/opportunity-service/src/opportunities/plan-setup-orchestrator.service.ts` | 132-170 | `createPlan` — передаёт amountIns в DTO |
| `apps/execution-orchestrator/src/plans/multi-leg-plan-builder.service.ts` | — | `buildMultiLegPlan` — может пересчитывать |
| `apps/execution-orchestrator/src/execution/adapters/uniswap-v2.adapter.ts` | — | `extractSwapParamsV2` — читает amountOutExpected |
| `apps/execution-orchestrator/src/execution/adapters/sushiswap-v2.adapter.ts` | — | `calculateAmountOutMin` — expectedAmountOut = 1729 |
| `apps/execution-orchestrator/src/execution/adapters/uniswap-v2.adapter.ts` | — | `enforcePostQuoteSlippageGate` — считает impact |

---

## Приложение: расчёт price impact

```
amountIn = 253126107426719989760 (253.1 MAGIC, 18 decimals)
expectedOut = 1729 (0.001729 USDC, 6 decimals)
tokenInDecimals = 18, tokenOutDecimals = 6 (разные → USD path)

amountInUnits = 253.1 MAGIC
expectedOutUnits = 0.001729 USDC

tokenInUsd = $0.0414 (MAGIC)
tokenOutUsd = $1.00 (USDC)

notionalInUsd = 253.1 * 0.0414 = $10.48
notionalOutUsd = 0.001729 * 1.00 = $0.0017

impactBps = ((10.48 - 0.0017) / 10.48) * 10000 = 9998 bps
```

**Проблема:** `expectedOut=1729` (0.0017 USDC) — слишком мало. Должно быть ~10,000,000 (10 USDC). Значение 1729 либо считалось от неправильного amountIn, либо это ошибка extraction из playbookConfig.

**Для slippage gate:** при `expectedOut=10000000` (10 USDC):
```
notionalOutUsd = 10 * 1.00 = $10.00
impactBps = ((10.48 - 10.00) / 10.48) * 10000 = 458 bps
```

458 bps всё равно > 50 bps max slippage. Это означает что pre-quoted модель имеет системную погрешность — реальный price impact для 253 MAGIC на SushiSwap пул с $39K ликвидности = ~458 bps (4.5%). Это много, но не 9998 bps.

---
---

## Сверка ZCode (добавлено при архивации, 2026-08-09)

### Гипотеза ТЗ — ОПРОВЕРГНУТА кодом + данными БД + логами

ТЗ строит цепочку «`amountOutExpected=10000000` превращается в `1729` где-то в адаптере / builder'е».
**Сверка с кодом показывает обратное:** значение `1729` — это **живой on-chain quote** от
SushiSwap router для мёртвого пула, а НЕ пересчёт в коде. Цитата «значение 1729 не совпадает
с 10000000. Оно было пересчитано внутри адаптера» — **неверна**.

### Доказательство №1 — код адаптера (`sushiswap-v2.adapter.ts`)

`calculateAmountOutMin` (строки 460-488) вызывает **`routerContract.getAmountsOut(params.amountIn, swapPath)`**
и возвращает `expectedAmountOut = amounts[amounts.length - 1]` (строка 477). Это **RPC-вызов к SushiSwap
router on-chain**, а НЕ чтение `params.amountOutExpected`. Значение `params.amountOutExpected` из plan
**вообще не используется** в gate — оно нужно только для V3-adapter validation.

`enforcePostQuoteSlippageGate` (строки 389-446) принимает `expectedAmountOut` (тот самый on-chain quote)
и считает impact в USD (строки 431-433): `notionalInUsd = amountInUnits × tokenInUsd`,
`notionalOutUsd = expectedOutUnits × tokenOutUsd`. Gate работает **корректно**.

### Доказательство №2 — данные БД (запрос к production `execution_plans`)

Для плана `ff6c1ead-e799-49d1-869b-d99f4e313797` (MAGIC, sell leg = leg 1):
- `playbook_config.legs[1].tokenIn` = `0x539bdE0d...` = **MAGIC** ✅
- `playbook_config.legs[1].amountIn` = `253126107426719989760` (253 MAGIC) ✅
- `playbook_config.legs[1].amountOutExpected` = **`10000000`** (10 USDC) ✅ — plan-setup передал **правильное** значение

То есть в БД лежит `10000000`, а не `1729`. Гипотеза ТЗ «значение в БД может быть 1729» — **неподтверждена**.

### Доказательство №3 — логи EO

Для того же плана `ff6c1ead` в логе:
```
amountOutMin: expected=1729 slippageBps=50 minOut=1720  ← SushiSwap adapter
expectedAmountOut=1729  ← это возврат routerContract.getAmountsOut()
```
Значение `1729` рождается в RPC-вызове к Sushi router для мёртвого пула (резервы ~0.038 MAGIC /
0.0017 USDC) и сразу идёт в gate. Через `playbookConfig` оно **не проходит**.

### Доказательство №4 — `MultiLegPlanBuilder` НЕ пересчитывает

`multi-leg-plan-builder.service.ts:272` просто прокидывает `amountOutExpected: leg.amountOutExpected`
без пересчёта. Тест `:568` явно проверяет passthrough (`toBeUndefined()`). Гипотеза ТЗ «builder пересчитывает» — **неверна**.

### Реальная причина блокировки (не та, что в ТЗ)

Сканер находит арбитражный спред между **живым UniV3 пулом MAGIC** (корректные резервы) и **мёртвым
SushiSwap V2 пулом MAGIC** (резервы ~0.038 MAGIC / 0.0017 USDC, ликвидность ~$1.50). Sushi router
честно возвращает мусорный quote (`1729` = $0.0017) для своих мусорных резервов. Slippage gate
**спасает** кошелёк от свапа 253 MAGIC за $0.0017 — это fail-closed, работает как задумано.

### Что НЕ нужно делать (опровергнутые шаги ТЗ)

- ❌ Шаг 1 (логирование `extractSwapParamsV2`): значение не читается из playbookConfig для gate; лог не прояснит.
- ❌ Шаг 2 (decimal conversion в `extractSwapParamsV2`): проблема не в decimals.
- ❌ Шаг 3 (правки plan-setup): amountIns рассчитаны **верно** (подтверждено БД).
- ❌ Правки `enforcePostQuoteSlippageGate`: gate работает правильно.

### Что НУЖНО делать (отдельный план, не PLAN12)

Реальный блокер — выше по потоку: **сканер эмитит арбитражи на мёртвых пулах**. Решение:
1. Фильтр пулов по реальным резервам / минимальной ликвидности в `scanner-service` (НЕ `minLiquidityUsd`,
   который Hermes сам отменил — это фильтр netProfit, см. changelog 20:15).
2. Опционально — не seeding мёртвых пулов в `pool-discovery` (seed только пулы с подтверждённой ликвидностью).

Это отдельный план (мёртвые пулы — системная проблема сканера), **не часть PLAN12**. ТЗ архивировано
как исторический артефакт; правки кода на его основе не вносятся.

### Дополнительная находка (ТЗ упустило)

Логи показывают **вторую** проблему — `SlippageProtectionService` (pre-trade cost estimation, отдельный
gate от `TradeCostEstimator`) тоже блокирует на мёртвых пулах: `9995 bps (max: 100)` и `10004 bps (max: 100)`
для pool `0x14Cc036360C896c20Bc816A2a7aA514bC843766f` (CRV/WETH). Та же корневая причина — мёртвые пулы.
И ещё: buy leg (UniV3) проходит slippage gate со stale-детекцией (`Using stale detection-time
amountOutExpected (QuoterV2 unreachable)`) — отдельный риск, но не блокер.
