# ТЗ: Консолидированный фикс live-сделок (аудит v2.1 + cross-check Гермеса)

**Дата:** 11 августа 2026
**Автор:** ZCode (комплексный аудит по шаблону v2.1 + факт-чек ТЗ Гермеса `tz-goal-audit-v2.1.md`)
**Коммит:** `1a7894b` (local == origin == server, верифицировано `git rev-parse`)
**Приоритет:** 🔴 CRITICAL (live minimal-capital mode, real money, $10 ceiling)
**Метод:** Каждое утверждение доказано staticCall / bytecode scan / БД / кодом. Метки 🔵 ДОКАЗАНО.

---

## 1. Контекст и обоснование

### 1.1 Почему это ТЗ существует

Сервер Aéza (`arbibot-paper`) находится в **live minimal-capital режиме** на Arbitrum mainnet
(`CAPITAL_MAX_ACTIVE_USD=10`, wallet `prod-arb-1` = `0xDea3E1E8cF92349cab0b46095aE03732afB646f3`).
Live-gate полностью открыт (`DEX_LIVE_KILL_SWITCH=false`, `DEX_VENUE_ENABLED=true`,
`LIVE_AUTO_DRIVE_ENABLED=true`, `LEG_AUTO_DRIVE_ENABLED=true`). Pipeline scanner → opportunity →
risk → capital → EO работает и создаёт планы.

**Проблема:** с 2026-07-22 ни одной новой завершённой live-сделки. Статистика БД на 2026-08-11:

```
execution_plans:   8827 failed | 6 completed (ВСЕ — E2E test планы, не real trades) | 115 planned | 3 executing
execution_legs:    374 failed | 6 filled (от 2026-07-22) | 1 sent (stale)
on_chain_transactions: 0 rows  ← все ноги падают ДО broadcast (на gas estimation)
```

**6 «completed» планов** (`arb:multi:ETH/ARB`, `arb:e2e:venue:*`) — это test/E2E артефакты, не
реальные live trades. playbook_config у них пустой. **Реальных успешных live сделок: 0.**

### 1.2 Источники

| Документ | Роль |
|----------|------|
| `C:\Users\kazak\Downloads\Telegram Desktop\template-goal-audit-v2.1.md` | Шаблон аудита (10 слоёв) |
| `C:\Users\kazak\Downloads\Telegram Desktop\tz-goal-audit-v2.1.md` | ТЗ Гермеса (7 блокеров) |
| Мой аудит v2.0 (4 блокера) | Первичный проход шаблона |
| Данный документ | Консолидация после факт-чека Гермеса |

### 1.3 Принцип

Капитал-sensitive. Все изменения затрагивают funded wallet на Arbitrum mainnet. Применять
скилл `dex-security-and-capital-safety`. Порядок фиксов критичен (см. §6) — сначала capital
protection (FIX-C), потом разблокировка execution.

---

## 2. Факт-чек ТЗ Гермеса (7 блокеров)

| Гермес # | Утверждение | Вердикт | Обоснование |
|----------|-------------|---------|-------------|
| 1 | `maxSlippageBps=50` блокирует, повысить до 200 | ⚠️ Частично верно, **опасный совет** | Gate действительно блокирует UNI/WETH (114 bps). Но Гермес сам доказал пару убыточной (-$1.12/$10). Повышение = пропустить убыточные. Gate работает корректно — проблема в паре и в cost gate fail-open, не в slippage limit |
| 2 | SwapRouter deadline mismatch | ✅ **Верно по сути, неточен в diagnosis** | Bytecode scan: selector `0x04e45aaf` отсутствует на Arbitrum SwapRouter. Корректный `0x414bf389`. Гермес считал selector валидным — на самом деле его нет в контракте. См. FIX-A |
| 3 | QuoterV2 нужен `.staticCall()` | ✅ Полностью верно | Совпадает с моим primary #1. См. FIX-B |
| 4 | Scanner V3 exempt от liquidity фильтра | ⚠️ Верно, но не блокер | Код подтверждает exemption (`scanner-spread.service.ts:156`). Создаёт ложный spread, но первичная проблема — хардкод fee в plan-builder (FIX-D) |
| 5 | `minNetProfitUsd` → $0.10 | ❌ **Неверно/опасно** | Гермес не обнаружил что cost gate **fail-OPEN при null gross profit**. Снижение floor бесполезно. Нужно FIX-C |
| 6 | ETH баланс $0.85 — пополнить | ✅ Верно | Подтверждено: 0.000445 ETH |
| 7 | Нужен больший капитал + новые пары | ⚠️ Верно, но ops а не код | UNI/WETH убыточна; нужно scanner tuning, не ручной подбор |

**Итог факт-чека:** 3/7 полностью верных (#2, #3, #6), 2 опасных (#1, #5), 2 частично верных (#4, #7).
**Ценность cross-check:** благодаря #2 Гермеса найден **новый primary блокер** (FIX-A), пропущенный
в моём первом аудите — selector `0x04e45aaf` отсутствует в bytecode контракта.

---

## 3. Реестр блокеров (консолидированный, 5 штук)

| # | Метка | Кратко | Фикс | Severity |
|---|-------|--------|------|----------|
| **A** | 🔵 | UniV3 router selector `0x04e45aaf` отсутствует в bytecode; нужен `0x414bf389` (8-field с deadline) | FIX-A | 🔴 PRIMARY |
| **B** | 🔵 | QuoterV2 вызывается как write (`sendTransaction`) вместо `staticCall` → всегда fallback на stale quote | FIX-B | 🔴 PRIMARY |
| **C** | 🔵 | Cost gate fail-OPEN: `netProfitUsd` всегда null → `minNetProfitUsd` gate мёртвый код | FIX-C | 🔴 CAPITAL SAFETY |
| **D** | 🔵 | Хардкод `fee: 500` в plan-builder; для 2/4 пар выбирает thin pool | FIX-D | 🔴 PRIMARY |
| **E** | 🟡 | RPC BlockPi 15 req/s rate limit (902 события); деградация, не hard blocker | ops | 🟡 SECONDARY |

**Порядок критичен:** C → A → B → D. См. §6.

---

## 4. Детальные спецификации фиксов

### FIX-A: UniV3 router ABI — добавить deadline (Blocker #5, PRIMARY)

**Проблема:** UniV3 adapter формирует calldata с selector `0x04e45aaf`
(`exactInputSingle`, 7-field struct без deadline). Этот selector **отсутствует в bytecode**
Arbitrum SwapRouter. Любой staticCall/estimateGas → `require(false)` (функции не существует).

**Root cause:** `packages/contracts-eth/src/abis/uniswap-v3-router.ts:64-85` — struct
`ExactInputSingleParams` содержит 7 полей: `tokenIn, tokenOut, fee, recipient, amountIn,
amountOutMinimum, sqrtPriceLimitX96`. **Без `deadline`.** Это генерирует selector `0x04e45aaf`,
соответствующий SwapRouter02 (Ethereum L1 / some L2), но **Arbitrum деплойнул классический
SwapRouter** с selector `0x414bf389` (8-field с deadline).

**Доказательство (🔵 ДОКАЗАНО):**
1. `provider.getCode('0xE592427A0AEce92De3Edee1F18E0157C05861564')` — bytecode scan:
   - selector `0x04e45aaf` → **ABSENT**
   - selector `0x414bf389` → **PRESENT**
2. `provider.call` с `0x04e45aaf` calldata (USDC/WETH fee=500, от wallet) → `require(false)`
3. `provider.call` с `0x414bf389` calldata (8-field с deadline) → `STF` (SafeTransferFail —
   функция **выполнилась**, revert только на transferFrom в eth_call симуляции, т.к. wallet не
   имеет реального состояния в эмуляции)
4. `factory()` и `WETH9()` на контракте возвращают корректные адреса — контракт валиден

**Изменения:**

**Файл 1:** `packages/contracts-eth/src/abis/uniswap-v3-router.ts`
- Struct `ExactInputSingleParams` (строки ~64-85): добавить `deadline` **5-м полем** (после
  `recipient`, перед `amountIn`):
  ```typescript
  { internalType: 'uint256', name: 'deadline', type: 'uint256' },
  ```
- Struct `ExactOutputSingleParams`: добавить `deadline` (проверить порядок полей по canonical
  Uniswap V3 ISwapRouter — deadline идёт после `recipient`)
- Struct `ExactInputParams`: добавить `deadline`
- Struct `ExactOutputParams`: добавить `deadline`

**Файл 2:** `apps/execution-orchestrator/src/execution/adapters/uniswap-v3.adapter.ts`
метод `buildSwapTxRequest` (~строка 745)
- Добавить `deadline` в encoded struct
- Значение: `Math.floor(Date.now() / 1000) + 300` (5 минут — консервативный, покрывает
  block time Arbitrum ~0.26s + latency)

**Альтернативный (более safe) подход:** использовать `multicall(uint256 deadline, bytes[] data)`
(selector `0x5ae401dc`, присутствует в bytecode) оборачивающий exactInputSingle. Это canonical
SwapRouter02 idiom для deadline protection. Решение за исполнителем — но `0x414bf389` проще.

**Верификация:**
```bash
# На сервере после деплоя:
node tools/_router_final.mjs  # должен показать selector 0x414bf389 + не require(false)
# Логи EO: gas_estimated шаг появляется (раньше revert на estimateGas)
```

**Тесты:** добавить unit-тест проверяющий selector кодируется как `0x414bf389`; интеграционный
тест с staticCall на Arbitrum mainnet fork (или testnet с тем же SwapRouter деплоем).

**Capital safety:** изменение calldata для funded wallet — обязательно прогнать через
`dex-security-and-capital-safety` skill. Смоки на $1 перед $10.

---

### FIX-B: QuoterV2 staticCall (Blocker #1, PRIMARY)

**Проблема:** UniV3 adapter вызывает `QuoterV2.quoteExactInputSingle` напрямую на контракте,
созданном с read-only `provider`. Метод объявлен `stateMutability: 'nonpayable'` → ethers v6
пытается `sendTransaction` → `UNSUPPORTED_OPERATION` → адаптер всегда падает на stale
detection-time quote (`usedLiveQuote=false`).

**Root cause:** `apps/execution-orchestrator/src/execution/adapters/uniswap-v3.adapter.ts:704`
```typescript
const result = await quoter.quoteExactInputSingle({...});  // ← без .staticCall
```
ABI: `packages/contracts-eth/src/abis/uniswap-v3-quoter.ts:40` — `stateMutability: 'nonpayable'`
(Quoter намеренно nonpayable, возвращает результат через revert-and-catch).

**Доказательство (🔵 ДОКАЗАНО):**
- Лог EO (08:15:35.025): `"QuoterV2 quote failed: contract runner does not support sending
  transactions (operation='sendTransaction', code=UNSUPPORTED_OPERATION)"`
- Воспроизведение (`tools/_quoter_test.mjs` на сервере):
  - прямой вызов → FAIL (идентичная ошибка)
  - `.staticCall()` → SUCCESS (fee=500: 0.995 CRV, fee=3000: 38.34 CRV)

**Изменение:**

**Файл:** `apps/execution-orchestrator/src/execution/adapters/uniswap-v3.adapter.ts:704`
```typescript
// Было:
const result = await quoter.quoteExactInputSingle({
// Стало:
const result = await quoter.quoteExactInputSingle.staticCall({
```

**Верификация:**
```bash
# Логи EO после деплоя:
pm2 logs execution-orchestrator --json --lines 5000 --nostream \
  | jq 'select(.msg | contains("QuoterV2 quote failed"))'  # должно быть пусто
# usedLiveQuote=true для UniV3 legs:
pm2 logs execution-orchestrator --json --lines 5000 --nostream \
  | jq 'select(.msg | contains("amount_out_min")) | .msg' | grep usedLiveQuote
```

**Тесты:** unit-тест мокающий Contract и проверяющий что вызывается `.staticCall`, не прямой метод.

---

### FIX-C: Cost gate fail-OPEN → передать grossProfitUsd (Blocker #3, CAPITAL SAFETY, ДЕЛАТЬ ПЕРВЫМ!)

**Проблема:** `minNetProfitUsd` gate ($1.00) **никогда не блокирует**, потому что
`netProfitUsd` всегда null. После FIX-A/B/D начнут исполняться реальные свопы — без этого
фикса все они будут убыточными ($10 notional → -$1.12 на UNI/WETH, -$12 на CRV/WETH через
thin pool). **$10 капитал сгорит за ~8 сделок.**

**Root cause (2 места):**

1. `apps/execution-service/src/cost/trade-cost-estimator.service.ts:565-578` — функция
   `extractGrossProfitUsd(plan)` читает `plan.playbookConfig.grossProfitUsd`. Если поля нет →
   возвращает `null`.
2. Строки 103-105 того же файла: `grossProfitUsd = extractGrossProfitUsd(plan)` → null →
   `netProfitUsd = null`.
3. Строки 162-163: `if (breakdown.netProfitUsd !== null && ... < minNetProfitUsd)` — при null
   **условие не выполняется**, gate пропускает.
4. `apps/opportunity-service/src/opportunities/plan-setup-orchestrator.service.ts:140-169` —
   body плана НЕ содержит `grossProfitUsd`. Комментарий строки 570-572: "multi-leg builder does
   not currently carry grossProfitUsd".

**Доказательство (🔵 ДОКАЗАНО):**
```sql
SELECT cost_breakdown->>'netProfitUsd', cost_breakdown->>'grossProfitUsd'
FROM execution_plans WHERE cost_breakdown IS NOT NULL ORDER BY created_at DESC LIMIT 1;
-- результат: netProfitUsd = null, grossProfitUsd = null
```
Config: `dex.limits.minNetProfitUsd = 1.00` (operator-raised from $0.50 default).

**Доказательство убыточности (если gate не сработает):**
cost_breakdown реального failed плана (CRV/WETH):
```
totalSlippageUsd: $13.65 (slippageBps 9997 на leg1)
totalCostUsd:     $13.69  >> notional $10
реальный netProfit: -$12.14 (если бы считался)
minNetProfitUsd floor: $1.00 (gate должен блокировать, но netProfit null)
```

**Изменение:**

**Файл:** `apps/opportunity-service/src/opportunities/plan-setup-orchestrator.service.ts`
метод `createPlan` (~строки 131-171), в body добавить:
```typescript
const body = {
  correlationId: input.correlationId,
  // ... существующие поля ...
  grossProfitUsd: input.grossProfitUsd,  // ← НОВОЕ ПОЛЕ
  legs: [...]
};
```

**Источник grossProfitUsd:** вычислить из opportunity evidence. Поля `buyPrice` и `sellPrice`
присутствуют в `arbitrage_opportunities.payload.evidence` (верифицировано SQL):
```sql
SELECT payload->'evidence'->>'buyPrice', payload->'evidence'->>'sellPrice'
FROM arbitrage_opportunities LIMIT 1;
-- buyPrice=0.000122, sellPrice=0.000141
```
Формула: `grossProfitUsd = notionalUsd × ((sellPrice - buyPrice) / buyPrice)`
(= notionalUsd × spreadBps / 10000, где spreadBps = (sell-buy)/buy × 10000).

**В caller'е `setupPlan`** (выше по файлу) — извлечь buyPrice/sellPrice из opportunity
payload, прокинуть в `PlanSetupInput.grossProfitUsd`. Если opportunity payload недоступен в
этом контексте — fetch по `input.routeKey`/`input.opportunityId`, либо передавать через
LiveAutoDriveWorker (он имеет доступ к opportunity).

**Fail-closed вариант (defense-in-depth):** если grossProfitUsd невозможно вычислить (нет
opportunity, null prices) → план НЕ создавать (throw), а не создавать с null. Это предотвратит
тихое прохождение через gate. Дополнительно можно сделать gate блокирующим при null
(изменить `trade-cost-estimator.service.ts:162` — но это меняет контракт для paper; лучше
fail на стадии plan-builder).

**Верификация:**
```sql
-- После фикса + новых планов:
SELECT cost_breakdown->>'netProfitUsd', cost_breakdown->>'grossProfitUsd'
FROM execution_plans WHERE created_at > <deploy-time> ORDER BY created_at DESC LIMIT 5;
-- netProfitUsd НЕ null (число); убыточные планы не проходят gate
```

**Тесты:** unit-тест plan-setup-orchestrator проверяет что `grossProfitUsd` в body;
unit-тест trade-cost-estimator что при переданном grossProfit убыточный план блокируется.

---

### FIX-D: Динамический выбор fee tier (Blocker #2, PRIMARY)

**Проблема:** `plan-setup-orchestrator.service.ts:154,165` хардкодит `fee: 500` для всех V3
legs с комментарием "most liquid tier" — **ЛОЖЬ для 2/4 пар**. Scanner НЕ передаёт fee в
opportunity (`payload.evidence` не содержит `fee` — верифицировано SQL).

**Доказательство (🔵 ДОКАЗАНО, 4 пары, §9.3 шаблона):**

| Пара | fee=500 liquidity | fee=3000 liquidity | Хардкод 500 корректен? |
|------|-------------------|--------------------|------------------------|
| CRV/WETH | THIN (9.2e15) | **LIQUID (2.7e22)** | ❌ 3000× тоньше |
| MAGIC/WETH | medium (2.1e17) | **LIQUID (3.0e21)** | ❌ |
| USDC/WETH | **LIQUID (3.6e18)** | medium (5.6e17) | ✅ |
| LINK/WETH | LIQUID (1.3e22) | LIQUID (9.1e22) | ✅ |

Все 27 failed CRV/WETH планов используют fee=500 (THIN pool). Через QuoterV2.staticCall на
fee=500: 0.995 CRV за 0.0053 WETH; на fee=3000: 38.34 CRV — в **44 раза** больше.

**Вариант 1 (предпочтительный): резолвить в plan-builder**

**Файл:** `apps/opportunity-service/src/opportunities/plan-setup-orchestrator.service.ts`

Добавить helper (кэшировать per-pair, TTL ~5 мин):
```typescript
async function resolveLiquidFeeTier(
  chainId: number,
  tokenIn: Address,
  tokenOut: Address,
): Promise<number> {
  const FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984'; // Arbitrum (map per chain)
  const provider = getProvider(chainId);
  const factory = new Contract(FACTORY, ['function getPool(address,address,uint24) view returns (address)'], provider);
  const poolAbi = ['function liquidity() view returns (uint128)'];
  let bestFee = 500; let bestLiq = 0n;
  for (const fee of [100, 500, 3000, 10000]) {
    const poolAddr = await factory.getPool(tokenIn, tokenOut, fee);
    if (poolAddr === ZeroAddress) continue;
    const liq = await new Contract(poolAddr, poolAbi, provider).liquidity();
    if (liq > bestLiq) { bestLiq = liq; bestFee = fee; }
  }
  return bestFee;
}
```
Использовать результат в `fee:` полях body (строки 154, 165) вместо хардкода 500.

**Вариант 2 (быстрее, требует правки scanner):** scanner знает пул при обнаружении spread —
передавать `fee` в opportunity evidence, plan-builder читает оттуда. Правки в
`scanner-spread.service.ts` (добавить `fee` в publish) + `plan-setup-orchestrator` (читать из
opportunity payload).

**Рекомендация:** Вариант 1 (plan-builder самодостаточен, не требует scanner round-trip).
Кэш критичен для производительности (4 RPC call на plan иначе).

**Дополнительный фикс (scanner-side, FIX-D2):** `scanner-spread.service.ts:156` — V3 exempt
от dead-pool фильтра. Это создаёт ложные spread'ы на thin V3 пулах. Снять exemption: считать
`liquidityUsd` для V3 из `reserve0` (=liquidity) × `quotePerBase`. Это предотвратит создание
opportunities на тонких пулах вообще.

**Верификация:**
```sql
SELECT playbook_config->'legs'->0->>'fee', route_key
FROM execution_plans WHERE created_at > <deploy-time> AND state='failed' LIMIT 10;
-- CRV/WETH планы: fee=3000 (не 500)
```

**Тесты:** unit-тест resolveLiquidFeeTier для 4 пар (CRV→3000, MAGIC→3000, USDC→500, LINK→500
или 3000); мок provider.

---

## 5. Ops-фиксы (после кодовых)

### FIX-G: Пополнить ETH

Кошелёк `0xDea3E1E8cF92349cab0b46095ae03732afb646f3` имеет 0.000445 ETH (~$0.85). Это
рискованно мало для gas на ~свопов.

**Действие:** перевести минимум **0.05 ETH** (~$95) на кошелёк. Через `npm run wallet:import`
path (если новый кошелёк) или прямой transfer на существующий.

### FIX-H: Scanner config tuning

Текущий poolWhitelist (`scanner.instances` `arb-2venue`) даёт пары типа UNI/WETH со spread
~15% cross-venue, но pool fee + price impact съедают прибыль. После FIX-A/B/C/D расширить
whitelist на пары с реальным spread (>100 bps net после pool fees).

**Действие:** через `/settings` UI или `npm run seed:scanner-config` добавить пары с
подтверждённой прибыльностью (проверять через staticCall на liquid fee tier).

**Внимание:** это итеративный ops процесс, не разовый фикс. Начать с 2-3 пар, мониторить P/L.

---

## 6. Порядок реализации (КРИТИЧЕН)

```
┌─────────────────────────────────────────────────────────────────┐
│  ФАЗА 0: CAPITAL SAFETY (до任何 разблокировки execution)         │
├─────────────────────────────────────────────────────────────────┤
│  1. FIX-C (cost gate fail-OPEN → передать grossProfitUsd)        │
│     ПОЧЕМУ ПЕРВЫМ: после FIX-A/B/D начнут исполняться реальные   │
│     свопы. Без cost gate все убыточные. $10 сгорит за ~8 сделок. │
│     Верификация: netProfitUsd НЕ null в БД, убыточные блокируются│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  ФАЗА 1: РАЗБЛОКИРОВКА EXECUTION (кодовые фиксы)                 │
├─────────────────────────────────────────────────────────────────┤
│  2. FIX-A (router selector 0x414bf389 + deadline)               │
│     Без него UniV3 swaps невозможны ВООБЩЕ (selector не exist)  │
│  3. FIX-B (QuoterV2 .staticCall)                                │
│     Без него stale quote → неверный amountOutMin                 │
│  4. FIX-D (динамический fee tier)                                │
│     Без него thin pool revert (CRV/WETH 0.995 vs 43.66)         │
│  5. Сборка: npm run build -w @arbibot/contracts-eth             │
│     npm run build -w @arbibot/execution-orchestrator            │
│     npm run build -w @arbibot/opportunity-service               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  ФАЗА 2: ДЕПЛОЙ + SMOKE (minimal capital)                       │
├─────────────────────────────────────────────────────────────────┤
│  6. Деплой на Aéza (см. aeza-deploy-workflow):                  │
│     cd /root/Arbibot-2 && git pull && npm run build (выше)      │
│     pm2 delete execution-orchestrator opportunity-service        │
│     pm2 start ecosystem.paper.config.cjs --only ...              │
│  7. ВРЕМЕННО снизить notional до $1 для smoke:                   │
│     LIVE_AUTO_DRIVE_MIN_NET_PROFIT_USD=-1 (временно разрешить   │
│     убыточные для smoke) ИЛИ дождаться первого валидного plan   │
│  8. Мониторинг первых 5 планов: логи EO, БД cost_breakdown,     │
│     on_chain_transactions                                        │
│  9. Если сделка прошла → восстановить minNetProfitUsd=$1.00      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  ФАЗА 3: OPS + МАСШТАБИРОВАНИЕ                                  │
├─────────────────────────────────────────────────────────────────┤
│ 10. FIX-G: пополнить ETH (0.05 ETH)                             │
│ 11. FIX-H: scanner config — пары с реальным spread              │
│ 12. Очистка stale планов (SQL ниже)                             │
│ 13. При стабильных profitable сделках → повысить CAPITAL_MAX     │
└─────────────────────────────────────────────────────────────────┘
```

**Почему FIX-C первым, а не параллельно:** Если выполнить FIX-A/B/D без C, pipeline начнёт
создавать И исполнять планы, но cost gate мёртвый → убыток. Это обратимый только до первого
broadcast шаг. После первого broadcast на funded wallet — деньги потрачены. Поэтому capital
protection ВСЕГДА раньше execution разблокировки.

---

## 7. Очистка БД (после фиксов, ФАЗА 3)

```sql
-- Stale armed/executing планы (никогда не исполнятся)
UPDATE execution_plans SET state = 'failed'
  WHERE state IN ('armed', 'executing')
    AND created_at < NOW() - INTERVAL '1 hour';

-- Stale legs
UPDATE execution_legs SET state = 'failed'
  WHERE state IN ('submitting', 'created')
    AND created_at < NOW() - INTERVAL '1 hour';

-- Очистить dedup-маркер чтобы LiveAutoDriveWorker мог перепланировать
UPDATE arbitrage_opportunities SET live_execution_plan_id = NULL
  WHERE state = 'risk_checked' AND live_execution_plan_id IS NOT NULL;

-- Опционально: очистить старые failed (не трогать completed/E2E)
-- DELETE FROM execution_plans WHERE state='failed' AND created_at < NOW() - INTERVAL '7 days';
```

⚠️ **Не выполнять** до деплоя фиксов — иначе новые планы сразу попадут в ту же дыру.

---

## 8. Что НЕ делать (опровергнутые подходы)

| Подход | Почему нет |
|--------|------------|
| ❌ Повысить `maxSlippageBps` 50 → 200 (Гермес #1) | Маскирует убыточность. UNI/WETH при 200 bps пройдёт gate, но потеряет $1.12. Slippage gate корректно работает — чинить cost gate (FIX-C), не ослаблять slippage |
| ❌ Снизить `minNetProfitUsd` $1.00 → $0.10 (Гермес #5) | Бесполезно: gate fail-OPEN при null netProfit. Floor не применяется пока netProfit null. Чинить FIX-C |
| ❌ Добавить deadline "как сказал Гермес" blindly | Гермес считал selector 0x04e45aaf валидным. Реально selector отсутствует в bytecode — нужен именно 0x414bf389. Верифицировать bytecode scan перед фикс |
| ❌ Перебирать пары вручную (Гермес #7) | Scanner автоматический. Tuning scanner config (FIX-H) системнее ручного подбора |
| ❌ Деплоить FIX-A/B/D без FIX-C | Capital loss на funded wallet. Сначала capital protection |

---

## 9. Post-fix verification checklist

- [ ] **FIX-A:** `node tools/_router_final.mjs` показывает selector `0x414bf389`, не `require(false)`
- [ ] **FIX-A:** В логах EO `step=gas_estimated` появляется для UniV3 legs (раньше revert)
- [ ] **FIX-B:** `QuoterV2 quote failed` отсутствует в логах EO (grep после деплоя)
- [ ] **FIX-B:** `usedLiveQuote=true` для UniV3 legs в `amount_out_min` логах
- [ ] **FIX-C:** `cost_breakdown.netProfitUsd` НЕ null в БД (число)
- [ ] **FIX-C:** Убыточный план (netProfit < $1.00) блокируется gate, не доходит до broadcast
- [ ] **FIX-D:** CRV/WETH plan создаётся с `fee=3000` (не 500)
- [ ] **FIX-D:** Для ≥3 пар: корректный fee tier (макс liquidity)
- [ ] `on_chain_transactions` count > 0 (первый успешный broadcast после 2026-07-22)
- [ ] `execution_plans` state='completed' с реальной парой (не E2E test)
- [ ] Баланс изменился на ожидаемую сумму (P&L в разумных пределах)
- [ ] WETH/ETH balance достаточен (после FIX-G)
- [ ] Нет зависших `submitting` legs (StuckPlanReaper здоров)

---

## 10. Финансовая модель (Слой 7, на реальных данных)

### Текущее состояние (CRV/WETH failed plan, до фиксов)

```
notional: $10 (amountInUsd)
spread (scanner evidence): (0.000141 - 0.000122) / 0.000122 = 15.5%
  gross profit (если бы считался): +$1.55
cost breakdown (из БД):
  pool fee (0.05% × 2 legs):    -$0.01
  gas (2 legs):                  -$0.027
  slippage (thin pool fee=500):
    leg0: 3653 bps →             -$3.653
    leg1: 9997 bps →             -$9.997  ← ~100% (0.995 CRV vs 43.66 ожидаемых)
  ─────────────────────────────
  totalCostUsd:                  $13.69
  netProfitUsd: null (gate не считает) → реально -$12.14
  minNetProfitUsd floor:         $1.00 (gate должен блокировать, но не блокирует)
```

### После всех фиксов (ожидаемо)

```
gross profit:         +$1.55 (передаётся в playbook, FIX-C)
pool fee (fee=3000, FIX-D): -$0.60 (0.3% × 2 legs × $10... нет, 0.3% per leg of $10 = $0.06)
gas:                  -$0.027
slippage (liquid pool):
  leg0: ~50 bps →     -$0.05
  leg1: ~50 bps →     -$0.05
─────────────────────
totalCost:            ~$0.19
netProfit:            +$1.36  ✅ > $1.00 floor → gate пропускает
```

⚠️ Это идеализированный расчёт. Реальный price impact на liquid pool при $10 notional нужно
подтвердить QuoterV2.staticCall (после FIX-B) для fee=3000 пула. Если spread 15.5% реален
(не scanner noise) — сделка прибыльна. Если spread на liquid tier'ах меньше (как с UNI/WETH
где -10% при любом notional) — пара не подходит, scanner config tuning (FIX-H).

### UNI/WETH (пара Гермеса) — убыточна при любом notional

Гермес доказал staticCall'ом:
```
$10 notional:  P&L = -$1.12 (-11%)
$50 notional:  P&L = -$4.94 (-10%)
$100 notional: P&L = -$10.07 (-10%)
```
Вывод: UNI/WETH cross-venue (Sushi/UniV3) не имеет достаточного spread. Scanner должен
фильтровать такие пары (FIX-H), а не execution пытаться их исполнить.

---

## 11. Ключевые файлы

| Файл | Что менять | Фикс |
|------|------------|------|
| `packages/contracts-eth/src/abis/uniswap-v3-router.ts` | Добавить `deadline` в 4 struct'а | FIX-A |
| `apps/execution-orchestrator/src/execution/adapters/uniswap-v3.adapter.ts:~745` | `deadline` в `buildSwapTxRequest` | FIX-A |
| `apps/execution-orchestrator/src/execution/adapters/uniswap-v3.adapter.ts:704` | `.staticCall()` в `quoteV3` | FIX-B |
| `apps/opportunity-service/src/opportunities/plan-setup-orchestrator.service.ts:140-169` | `grossProfitUsd` в body | FIX-C |
| `apps/opportunity-service/src/opportunities/plan-setup-orchestrator.service.ts:154,165` | Динамический `fee` | FIX-D |
| `apps/scanner-service/src/scanner/scanner-spread.service.ts:156` | (опц.) снять V3 exemption | FIX-D2 |
| БД `policy_configurations` | НЕ менять `maxSlippageBps`/`minNetProfitUsd` | — |

---

## 12. Риски и mitigation

| Риск | Mitigation |
|------|------------|
| FIX-A меняет calldata для всех UniV3 свопов → regression | Тест selector = `0x414bf389`; smoke на $1 перед $10 |
| FIX-C grossProfitUsd может быть неточным (scanner noise) | Gate блокирует при netProfit < floor; лучше перестраховаться |
| FIX-D RPC calls (4 на plan) замедляют plan-builder | Кэш per-pair TTL 5 мин |
| После деплоя первые сделки убыточны (scanner config) | Smoke на $1; мониторить первые 5; готовность `panic:stop` |
| ETH balance $0.85 — gas может не хватить на broadcast | FIX-G до ФАЗЫ 2 деплоя |
| Race: LiveAutoDriveWorker (10s) может создать план во время деплоя | Деплойить с `LIVE_AUTO_DRIVE_ENABLED=false`, включать после smoke |

---

## 13. Ссылки

- Memory: `live-blocker-v3-router-selector.md`, `live-blocker-quoterv2-staticcall.md`,
  `live-minimal-capital-active.md`, `aeza-deploy-workflow.md`
- Шаблон аудита: `C:\Users\kazak\Downloads\Telegram Desktop\template-goal-audit-v2.1.md`
- ТЗ Гермеса: `C:\Users\kazak\Downloads\Telegram Desktop\tz-goal-audit-v2.1.md`
- Deploy workflow: `docs/deployment-guide.md`, memory `aeza-deploy-workflow.md`
- Capital safety skill: `.cursor/skills/dex-security-and-capital-safety/SKILL.md`

---

**Статус:** ТЗ готово к реализации. Порядок: FIX-C → FIX-A → FIX-B → FIX-D → деплой + smoke
($1) → FIX-G/H → масштабирование. Применять `dex-security-and-capital-safety` skill на каждом
кодовом фиксе (funded wallet, real money).
