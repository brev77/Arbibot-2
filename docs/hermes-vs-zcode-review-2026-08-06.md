# Ревью анализа Hermes: фиксы live-торговли vs решения ZCode

**Дата анализа:** 2026-08-06
**Исходный документ:** `zcode-vs-hermes-analysis.md` (Hermes, 2026-08-05)
**Контекст:** Факт-чек утверждений Hermes против актуального состояния кода на коммите `957e9d5`.
**Метод:** Прямое чтение исходников + проверка поведения `ethers@6.17.0` в `node_modules/ethers` + `git log` по коммитам.

---

## TL;DR

Hermes прав по большинству пунктов, но в трёх местах неточен. Финальные вердикты:

| # | Пункт | Вердикт Hermes | Реальность кода | Итог |
|---|-------|----------------|-----------------|------|
| 1 | Chainlink вместо DEX fallback | ✅ ZCode прав | Подтверждено | ✅ Согласен с Hermes |
| 2 | Pool discovery seed-addresses | ✅ ZCode прав | Подтверждено | ✅ Согласен |
| 3 | **staticNetwork убран** | ❌ ZCode неправ | **Hermes прав по существу** | ⚠️ Вернуть pin |
| 4 | Cache null | ⚠️ Не подтверждено | **Уже починено ZCode** | ✅ Решено, действий не требует |
| 5 | KNOWN_DECIMALS убран | ⚠️ Требует проверки | **Hermes ошибся** — карта на месте | ❌ Hermes неправ |
| 6 | Audit UUID | ⚠️ LOW | **Подтверждено** — реальный баг | ⚠️ Согласен (severity: Medium) |
| 7 | **V3 pricing** | 🔴 Блокер | **Подтверждено** | 🔴 Согласен, блокер |

**Два пункта требуют действия:**
- 🔴 **V3 pricing gap** — реальный блокер cost gate для V3-only токенов (MAGIC и др.).
- ⚠️ **staticNetwork** — реверс в коммите `6bbe45e` контрпродуктивен, pin нужно вернуть.

**Два пункта ложные тревоги:**
- Cache null — уже исправлено (null не кэшируется, TTL поднят до 60с).
- KNOWN_DECIMALS — карта `KNOWN_DECIMALS_BY_ADDRESS` живёт в `price-oracle.service.ts:60-75` и используется в `getTokenDecimals()`.

---

## Методология

Проверка выполнена прямым чтением:

- `apps/execution-orchestrator/src/execution/price/price-oracle.service.ts` (473 строки)
- `apps/execution-orchestrator/src/execution/rpc/rpc-provider-manager.service.ts` (256 строк)
- `apps/execution-orchestrator/src/execution/pool/pool-discovery.service.ts` (485 строк)
- `packages/nest-platform/src/audit-client.service.ts` (109 строк)
- `apps/audit-service/src/audit/dto/append-audit.dto.ts`
- `apps/audit-service/src/audit/audit.service.ts`
- `apps/scanner-service/src/scanner/v3-price.ts`
- `node_modules/ethers/lib.commonjs/providers/provider-jsonrpc.js` + `abstract-provider.js` — для проверки фактического поведения `staticNetwork` в `ethers@6.17.0` (установленной версии)
- `git log` + `git show 6bbe45e` для контекста реверса

---

## Пункт-по-пункту

### ✅ #1. Chainlink вместо DEX fallback — Hermes и ZCode согласны

| | |
|---|---|
| **Фикс Hermes** | `readNativeUsdViaDex()` — fallback на SushiSwap WETH/USDC пул |
| **Решение ZCode** | Убрал fallback, починил corrupted Chainlink адрес + BigInt-сравнение |
| **Вердикт** | ✅ ZCode прав |

**Верификация:**
- Символ `readNativeUsdViaDex` отсутствует в репо (0 совпадений, case-insensitive, все типы файлов).
- Chainlink-путь на месте: `price-oracle.service.ts:215` `readChainlinkNativeUsd()`.
- Коммиты `0ad81d0` (corrupted address) + `82dcf3b` (BigInt split) подтверждают починку корневой причины.

Оценка Hermes корректна: первичный источник цены важнее костыльного fallback'а.

---

### ✅ #2. Pool discovery seed-addresses — Hermes и ZCode согласны (частично)

| | |
|---|---|
| **Фикс Hermes** | `priceArbitraryViaDirectRpc()` — хардкод таблицы пулов + прямой `getReserves` |
| **Решение ZCode** | Убрал direct-RPC, починил seed-addresses в `PoolDiscoveryService` |
| **Вердикт** | ✅ ZCode прав (частично) |

**Верификация:**
- `priceArbitraryViaDirectRpc` отсутствует в репо (0 совпадений).
- `pool-discovery.service.ts:79-84` — `DEFAULT_SEED_POOLS` с тремя SushiSwap V2 пулами Arbitrum (WETH/USDC, WETH/USDC.e, WETH/USDT).
- Коммит `4470e87` — «real SushiSwap V2 seed pool addresses on Arbitrum».

**Замечание Hermes валидно:** это решение неполное, т.к. V3 пулы всё равно skip'аются (см. #7).

---

### ⚠️ #3. staticNetwork убран — **Hermes прав по существу**

| | |
|---|---|
| **Фикс Hermes** | `staticNetwork: true` для блокировки переопределения chainId |
| **Решение ZCode** | Убрал pin (коммит `6bbe45e`) |
| **Вердикт Hermes** | ❌ ZCode неправ |
| **Итог факт-чека** | ✅ **Hermes прав** — реверс контрпродуктивен |

#### Разбор по коду ethers v6.17.0

Ошибка `network changed: 1 => 42161` возникает в `abstract-provider.js:625-639` — `getNetwork()` сравнивает кэшированную сеть со свежим `_detectNetwork()` **на каждом вызове**:

```js
// abstract-provider.js:621-639
const [expected, actual] = await Promise.all([
  networkPromise,
  this._detectNetwork()   // ← свежий eth_chainId каждый раз
]);
if (expected.chainId !== actual.chainId) {
  if (this.#anyNetwork) { /* ... уведомление ... */ }
  else {
    assert(false,
      `network changed: ${expected.chainId} => ${actual.chainId} `,
      "NETWORK_ERROR", { event: "changed" });
  }
}
```

**Ключевое:** `_detectNetwork()` (`provider-jsonrpc.js:401-412`) при `staticNetwork: true` возвращает пин **без RPC-запроса**:

```js
// provider-jsonrpc.js:401-412
async _detectNetwork() {
  const network = this._getOption("staticNetwork");
  if (network) {
    if (network === true) {
      if (this.#network) { return this.#network; }   // ← БЕЗ eth_chainId
    } else { return network; }
  }
  // ... дальше — fresh eth_chainId запрос
}
```

**Вывод:** при `staticNetwork: true` + `new JsonRpcProvider(url, 42161)`:
- `expected` = 42161 (пин), `actual` = 42161 (пин) → сравнение всегда true.
- `NETWORK_ERROR` **невозможен** при расхождениях load-balancer'а.

#### Опровержение комментария в коммите `6bbe45e`

Коммит утверждает:
> *"With staticNetwork: true, ethers v6 throws 'NETWORK_ERROR: network changed: 1 => 42161' on EVERY read"*

Это **технически неверно**. Симптом `network changed: 1 => 42161` — это как раз симптом **отсутствия** staticNetwork: первый `eth_chainId` через load-balancer попал на Ethereum-ноду (chainId=1), второй — на Arbitrum (42161), сравнение бросает `NETWORK_ERROR`. Текущий код (без staticNetwork) подвержен этой ошибке, а не защищён от неё.

Комментарий в `rpc-provider-manager.service.ts:84-91` повторяет ту же неточность.

#### Где Hermes неточен

Цитата Hermes про *"re-derives on each call"* тоже не совсем аккуратна: без staticNetwork ethers не «re-derives на каждый вызов», а кэширует сеть после первого `eth_chainId`, а затем сравнивает с переопределением — что и порождает проблему. Но **итоговая рекомендация Hermes верна**: вернуть `staticNetwork: true`.

#### Caveat (справедливый trade-off)

`staticNetwork` маскирует стойкое направление на неправильную сеть (env указывает на Ethereum mainnet, ethers не ругается). Это компенсируется существующими гарантиями, упомянутыми в комментарии `6bbe45e`:
- `ci-address-checksum` guard
- `/health/rpc` healthcheck

С ними pin безопасен. Текущий код `rpc-provider-manager.service.ts:92` уже передаёт chainId в конструктор — остаётся добавить опцию:

```typescript
const primary = new JsonRpcProvider(config.primary, config.chainId, { staticNetwork: true });
```

---

### ✅ #4. Cache null — **уже починено ZCode**

| | |
|---|---|
| **Фикс Hermes** | Не кэшировать null в `priceCache` |
| **Утверждение Hermes** | «Решение ZCode не подтверждено» |
| **Итог факт-чека** | ✅ **Уже сделано** — запись Hermes устарела |

**Верификация** — `price-oracle.service.ts:151-157`:

```typescript
// Cache RESOLVED prices only — do NOT cache nulls. Caching nulls (previous behaviour)
// meant a transient RPC failure (rate limit, momentary network blip) would freeze every
// subsequent price read at null for the whole TTL window, blocking the live cost gate
// even after the RPC recovered. Now a null retries on the next call.
if (price !== null) {
  this.priceCache.set(key, { price, expiresAt: Date.now() + PRICE_CACHE_TTL_MS });
}
```

**Дополнительно** — заголовок модуля (`price-oracle.service.ts:40-45`):

```typescript
// Cache TTL for resolved prices. 60s balances price freshness against RPC rate limits —
// public Arbitrum RPCs throttle around ~50 req/min and transient 429s were poisoning the
// cache when nulls were cached at the previous 10s TTL. Resolved prices only land here;
// nulls are never cached (transient failures should be retried on the next call, not
// served from cache).
const PRICE_CACHE_TTL_MS = 60_000;
```

**Итог:** null никогда не кэшируется. TTL для resolved цен поднят с 10с до 60с (429-е poisoning — теперь отдельный риск retry-storm, но с TTL 60с он ограничен). Беспокойство Hermes закрыто, действий не требует.

---

### ❌ #5. KNOWN_DECIMALS убран — **Hermes ошибся**

| | |
|---|---|
| **Фикс Hermes** | Хардкод decimals для 13 токенов в `getTokenDecimals()` |
| **Утверждение Hermes** | «ZCode убрал KNOWN_DECIMALS из PriceOracle» |
| **Итог факт-чека** | ❌ **Hermes неправ** — карта на месте |

**Верификация:**

1. Карта существует — `price-oracle.service.ts:60-75`:
   ```typescript
   const KNOWN_DECIMALS_BY_ADDRESS: Record<string, number> = {
     '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 18, // WETH
     '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 6,  // USDC (native)
     // ... 13 токенов, включая MAGIC (0x539bde0d... → 18)
   };
   ```

2. Используется в `getTokenDecimals()` — `price-oracle.service.ts:352-368`:
   ```typescript
   async getTokenDecimals(chainId, tokenAddress): Promise<number | null> {
     // ...
     // Fallback для well-known tokens (fix #9). Avoids an RPC call on the hot path
     // and survives transient RPC rate-limits that would otherwise null-out decimals
     // and fail-closed the cost gate.
     if (chainId === ChainId.ARBITRUM_ONE_MAINNET) {
       const known = KNOWN_DECIMALS_BY_ADDRESS[tokenLower];
       if (typeof known === 'number') {
         this.decimalsCache.set(key, known);
         return known;
       }
     }
     // ... дальше — RPC fallback
   }
   ```

**Дополнительно:** `KNOWN_DECIMALS_BY_ADDRESS` также объявлена в `opportunity-service/src/opportunities/token-resolver.service.ts:42` — это **независимая копия**, обе живы.

Замечание Hermes неактуально. Возможная будущая работа — консолидация двух копий (DRY), но это cleanup, не блокер.

---

### ⚠️ #6. Audit UUID — **реальный баг (согласен с Hermes)**

| | |
|---|---|
| **Severity Hermes** | LOW (спам логов) |
| **Итог факт-чека** | ⚠️ **Подтверждено**, но severity скорее **Medium** |

#### Корень несоответствия

**Серверная валидация** — `append-audit.dto.ts:4-6`:

```typescript
@IsOptional()
@IsUUID('4')
idempotencyKey?: string;
```

`@IsUUID('4')` отклоняет любой не-UUID формат.

**Клиенты шлют семантические строки** (не UUID ни в одном случае):

| Файл:строка | Формат ключа |
|-------------|---------------|
| `capital.service.ts:184` | `capital:ReserveCapital:${saved.id}` |
| `capital.service.ts:253` | `capital:ReleaseReservation:${saved.id}` |
| `trade-cost-estimator.service.ts:305` | `cost-estimate:${plan.id}:${legIndex}` |
| `legs.service.ts:248` | `execution:BeginExecution:${plan.id}` |
| `legs.service.ts:405` | `bridge:${plan.id}:${leg.id}` |
| `legs.service.ts:585, 618, 654, 697` | `execution:MarkLeg*:${saved.id}:v${entityVersion}` |
| `configurations.service.ts:524, 629` | `arb:config:v1:promote:idemp:${idempotencyKey}` |

**Результат:** **каждый** audit-вызов с `idempotencyKey` падает с HTTP 400.

#### Почему severity Medium, не LOW

Hermes занижает важность. Это не просто «спам логов»:

1. `AuditClientService.record()` — fire-and-forget (домен не блокируется, ОК).
2. `AuditClientService.appendEntry()` — **await'ит** HTTP round-trip (`audit-client.service.ts:67`). Любой вызов с невалидным ключом заставляет caller ждать timeout/ошибку.
3. **Главное:** вся функциональность дедупликации аудита нерабочая. `audit.service.ts:47-83` рассчитывает на UNIQUE-индекс БД + pessimistic_write lock по `idempotencyKey` для защиты от дублей. При 400 строка до БД не доходит → дубли спокойно пишутся.

#### Рекомендуемый фикс

Серверный — заменить `@IsUUID('4')` на более мягкую валидацию:

```typescript
@IsOptional()
@IsString()
@MaxLength(255)
idempotencyKey?: string;
```

Уникальность всё равно обеспечивает БД (UNIQUE на колонке). Формат ключа семантический, не UUID — это корректный дизайн для человекочитаемых ключей.

---

### 🔴 #7. V3 pricing — **реальный блокер (полностью согласен)**

| | |
|---|---|
| **Статус** | Не починен ни Hermes, ни ZCode |
| **Итог факт-чека** | 🔴 **Подтверждено**, блокер cost gate |

#### Подтверждение двух половин блокера

**(a) PriceOracle skip'ает V3** — `price-oracle.service.ts:281-284`:

```typescript
if (pool.protocol === 'uniswap-v3') {
  // V3 reserves are unreliable for pricing in v1; skip.
  return null;   // ← все V3-only токены (MAGIC и др.) = null → cost gate fail-closed
}
```

**(b) PoolDiscovery фейлит V3 резервы** — `pool-discovery.service.ts:346-361`:

```typescript
// For V3, reserves are represented as liquidity + slot0
const liquidity = await contract.liquidity();

return {
  // ...
  reserve0: BigInt(liquidity),   // ← математически бессмысленно как цена
  reserve1: BigInt(liquidity),   // ← комментарий в scanner/v3-price.ts прямо фиксирует это
  protocol: 'uniswap-v3',
  // ...
};
```

Комментарий-обоснование в `apps/scanner-service/src/scanner/v3-price.ts:6-9`:

> *"Fixes the gap in apps/execution-orchestrator/src/execution/pool/pool-discovery.service.ts:236, which dumps `liquidity` into both reserve0/reserve1 — mathematically meaningless as a price."*

#### Цепочка блокировки (по Hermes, подтверждено)

1. MAGIC торгуется на Uniswap V3 → `priceArbitraryViaPool` находит V3 пул → skip → null.
2. `getTokenPriceUsd(MAGIC)` = null.
3. Cost gate: `Cost estimate unavailable for leg(s) 0, 1`.
4. Все планы с MAGIC блокируются (fail-closed).

#### Хорошая новость: V3-математика уже в репо

В `apps/scanner-service/src/scanner/v3-price.ts` **уже реализована** корректная математика:

```typescript
const Q96 = 2n ** 96n;

export function v3PriceRaw(sqrtPriceX96: bigint): number {
  const numerator = sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n;
  const denominator = Q96 * Q96; // 2^192
  const scaledPrice = numerator / denominator;
  return Number(scaledPrice) / 1e18;
}

export function v3Price(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  const raw = v3PriceRaw(sqrtPriceX96);
  const decimalAdjust = decimals0 - decimals1;
  return raw * Math.pow(10, decimalAdjust);
}
```

Пример кода из анализа Hermes (строки 134-146) фактически дублирует эту функцию. Правильнее **переиспользовать** готовую `v3Price()`, а не писать новую копию.

#### Что нужно сделать (точнее, чем у Hermes)

**Шаг 1 — `pool-discovery.service.ts`:**
- В `tryUniV3Pool` (`pool-discovery.service.ts:322-365`) прочитать `slot0` (ABI уже объявлен в строке 332).
- Сохранить `sqrtPriceX96` в `DiscoveredPool` как **новое поле** (не лить в reserve0/reserve1).

**Шаг 2 — `price-oracle.service.ts`:**
- Заменить `return null` (строка 283) на ветку через `v3Price()` из `scanner/v3-price.ts` → домножить на WETH USD из Chainlink.

**Шаг 3 — MVP-обход для MAGIC:**
- Проверить, есть ли SushiSwap V2 пул MAGIC/WETH на Arbitrum. Если есть — добавить его в `DEFAULT_SEED_POOLS` (`pool-discovery.service.ts:79-84`), тогда V3-патч для MAGIC конкретно не понадобится.
- Если MAGIC реально V3-only — необходима реализация шагов 1+2.

#### Дополнительная находка: MAGIC отсутствует в registry

`grep -i magic` по:
- `apps/scanner-service/src/scanner/scanner-pool.constants.ts` → 0 совпадений.
- `pool-discovery.service.ts:79-84` `DEFAULT_SEED_POOLS` → MAGIC/WETH нет.

Даже после V3-фикса цена MAGIC появится только если его пул попадёт в кэш discovery — сейчас этого не происходит. Нужен либо seed MAGIC/WETH пула, либо чтобы discovery подхватывал его по событиям сканера.

---

## Рекомендации (с корректировкой приоритетов Hermes)

### 🔴 Приоритет 1 — V3 pricing

Реализовать через существующий `scanner/v3-price.ts` + сохранение `slot0` в `DiscoveredPool`.

Конкретные шаги:
1. Расширить интерфейс `DiscoveredPool` (`pool-discovery.service.ts:30-44`) полем `sqrtPriceX96?: bigint`.
2. В `tryUniV3Pool` прочитать `slot0[0]` и сохранить в новом поле (не лить в reserve).
3. В `price-oracle.service.ts:281-284` заменить `return null` на импорт `v3Price()` из scanner → расчёт → домножение на Chainlink WETH USD.
4. Добавить MAGIC/WETH пул в `DEFAULT_SEED_POOLS` (если V2 существует) либо убедиться, что discovery находит MAGIC через scanner-события.

Без этого cost gate блокирует любой V3-only токен.

### ⚠️ Приоритет 2 — staticNetwork

Вернуть pin:

```typescript
// rpc-provider-manager.service.ts:92
const primary = new JsonRpcProvider(config.primary, config.chainId, { staticNetwork: true });
// то же для backup (строка 97)
```

Логика реверса `6bbe45e` неверна (см. §3): симптом `network changed: 1 => 42161` — это как раз симптом отсутствия pin, а не его наличия. Защиту от misconfig (env указывает на неверную сеть) покрывает существующий `ci-address-checksum` + `/health/rpc`. Обновить комментарий в `rpc-provider-manager.service.ts:84-91` под корректное обоснование.

### ⚠️ Приоритет 3 — Audit UUID

Заменить `@IsUUID('4')` на `@IsString()` + `@MaxLength(255)` в `append-audit.dto.ts:5`.

Это Medium, не LOW: сейчас дедупликация аудита полностью нерабочая, т.к. строка с невалидным ключом не доходит до БД-уровня с UNIQUE-индексом. Альтернатива — конвертировать ключи в UUID на стороне клиента, но это ломает человекочитаемость и требует правок во всех ~15 call sites.

### ✅ Без действий

- **Cache null (#4)** — уже исправлено, null не кэшируется.
- **KNOWN_DECIMALS (#5)** — карта на месте, замечание Hermes ошибочно.
- **Chainlink fix (#1)** и **Pool discovery seed (#2)** — уже сделаны правильно, Hermes с этим согласен.

---

## Приложение A — Ключевые файлы и строки

| Файл | Что искать |
|------|------------|
| `apps/execution-orchestrator/src/execution/price/price-oracle.service.ts` | V3 skip (281-284), null cache fix (151-157), KNOWN_DECIMALS (60-75, 362-368), Chainlink read (215-249) |
| `apps/execution-orchestrator/src/execution/rpc/rpc-provider-manager.service.ts` | staticNetwork комментарий (84-91), конструктор (92, 97) |
| `apps/execution-orchestrator/src/execution/pool/pool-discovery.service.ts` | DEFAULT_SEED_POOLS (79-84), tryUniV3Pool фейлит резервы (346-361) |
| `apps/scanner-service/src/scanner/v3-price.ts` | Готовая V3-математика для переиспользования |
| `packages/nest-platform/src/audit-client.service.ts` | Клиент аудита |
| `apps/audit-service/src/audit/dto/append-audit.dto.ts` | `@IsUUID('4')` — корень бага #6 |
| `apps/audit-service/src/audit/audit.service.ts` | Серверная дедупликация |

## Приложение B — Коммиты по теме

| Коммит | Описание |
|--------|----------|
| `957e9d5` | docs(live): smoke update — BigInt + pool-discovery fixes, remaining V3-pricing gap |
| `10e6eef` | fix(pool-discovery): BigInt(bigint) wrapping threw on ethers v6 reserves |
| `4470e87` | fix(pool-discovery): real SushiSwap V2 seed pool addresses on Arbitrum |
| `82dcf3b` | fix(price-oracle): split BigInt/number comparison in Chainlink read |
| `6bbe45e` | fix(live): revert staticNetwork #12 — (контрпродуктивный реверс, см. §3) |
| `0ad81d0` | fix(live): post-Hermes audit — corrupted Chainlink addr + 8 verified fixes |
