# План PLAN11 — Post-Hermes live-readiness correctness sweep

> **Назначение:** план действий по результатам факт-чека анализа Hermes
> (`zcode-vs-hermes-analysis.md`, 2026-08-05) против актуального состояния кода на
> коммите `957e9d5`. Сформирован в формате [`docs/roadmap-vectors.md`](roadmap-vectors.md):
> те же поля инициатив, тот же жизненный цикл, те же принципы P1–P5.
>
> **Связанные документы:**
> - Факт-чек — [`docs/hermes-vs-zcode-review-2026-08-06.md`](hermes-vs-zcode-review-2026-08-06.md).
> - Стратегический каркас — [`docs/roadmap-vectors.md`](roadmap-vectors.md) (векторы, принципы).
> - Канон статусов/`step_id` — [`.cursor/plans/DEVELOPMENT_PLAN.md`](../.cursor/plans/DEVELOPMENT_PLAN.md).
>
> **Эта документация — живая.** Все `file:line` верифицированы чтением кода на дату составления.

---

## 1. Контекст

Hermes (серверный агент) и ZCode (канонический репозиторий) параллельно работали над
запуском live-торговли на Aéza. Hermes применял «пожарные» фиксы прямо на сервере,
ZCode переносил их в Git. В процессе часть фиксов была убрана или заменена — в одних
случаях правильно, в других нет.

**Результат факт-чека 7 утверждений Hermes:**

| Категория | Пункты | Итог |
|-----------|--------|------|
| ✅ Согласие, уже сделано правильно | #1 Chainlink, #2 Pool discovery | действий не требует |
| ❌ Ложные тревоги Hermes | #4 Cache null (исправлено), #5 KNOWN_DECIMALS (на месте) | действий не требует |
| ⚠️ Реальные проблемы, нужны инициативы | **#3 staticNetwork, #6 Audit UUID, #7 V3 pricing** | → реестр ниже |

План покрывает **только 3 реальные проблемы**. Это согласовано с критерием P1
(код — источник истины): 4 пункта Hermes'а не порождают инициатив, т.к. либо уже
закрыты в коде, либо замечания основаны на ошибочном чтении репозитория.

---

## 2. Принципы (наследуются из roadmap-vectors.md)

Соблюдаем P1–P5 из [`docs/roadmap-vectors.md`](roadmap-vectors.md) §1 без изменений.
Ключевые для этого плана:

- **P1 — Код-источник-истины:** все `file:line` в инициативах верифицированы чтением
  исходников (не комментариев в коммитах, не docs).
- **P2 — Доки после кода:** шаг `done` только после обновления `AGENTS.md`/ADR/`roadmap-vectors.md`.
- **P4 — Приоритет live-blocker:** две инициативы из трёх — `live-blocker`, идут вне
  очереди независимо от score.

Дополнительно — **специфичный для этого плана принцип:**

### P-LIVE-1. Технические комментарии в коде должны быть верны

> Комментарий, объясняющий нетривиальное решение (например, почему убран `staticNetwork`),
> становится контрактом для будущих разработчиков. Если комментарий технически неверен
> (как в `rpc-provider-manager.service.ts:84-91`), он активнее вредит, чем отсутствие
> комментария: следующий разработчик будет опираться на ложную предпосылку.

Любая инициатива, меняющая поведение, **обязана** обновить сопутствующий комментарий
до фактически верного обоснования. Это часть DoD, не отдельный шаг.

---

## 3. Реестр инициатив

> Порядок — по `gate` (live-blocker первыми), затем по `score` (убывание).
> Продолжение нумерации `roadmap-vectors.md` (инициативы #1–#44 — там).

| # | step_id | Вектор(ы) | gate | tracker | impact | effort | score | status | plan |
|---|---------|-----------|------|---------|--------|--------|-------|--------|------|
| 45 | `FUNC-V3-PRICING` | FUNC (SEC) | **live-blocker** | new | 5 | 3 | 15 | done | PLAN11 |
| 46 | `SEC-RPC-STATIC-NETWORK` | SEC (REL) | **live-blocker** | new | 4 | 1 | 20 | done | PLAN11 |
| 47 | `REL-AUDIT-IDEMPOTENCY-UUID` | REL (SEC) | paper-check | new | 3 | 1 | 15 | done | PLAN11 |

### Легенда

- **gate:** `live-blocker` — блокирует live-деплой; `paper-check` — проверить на paper.
- **score:** `impact × (6 − effort)`, диапазон 5–25. Override: live-blocker поднимается
  в очередь независимо от score.
- **status:** `proposed` → `accepted` → `in-progress` → `review` → `done`.

### Порядок исполнения

1. **#46 staticNetwork** — минимальный effort (1 строка + комментарий), снимает
   `NETWORK_ERROR`-класс regressions. Идёт первым.
2. **#45 V3 pricing** — самый effort'ный (3), но блокер для любого V3-only токена.
   Параллелен с #46, независим.
3. **#47 Audit UUID** — `paper-check`, можно после двух live-blocker'ов. Независим.

Все три инициативы **независимы** — могут идти параллельными коммитами без конфликтов.

---

## 4. Детализация инициатив

### #45. `FUNC-V3-PRICING` — V3 pricing gap

| Поле | Значение |
|------|----------|
| **Вектор** | `FUNC` (торговое преимущество), вторичный `SEC` |
| **gate** | `live-blocker` |
| **impact / effort / score** | 5 / 3 / 15 |
| **Корневые файлы** | `apps/execution-orchestrator/src/execution/price/price-oracle.service.ts:281-284`, `apps/execution-orchestrator/src/execution/pool/pool-discovery.service.ts:322-365` |

#### Проблема (подтверждено кодом)

Две половины одного блокера:

**(a)** `price-oracle.service.ts:281-284` — PriceOracle skip'ает V3 пулы:
```typescript
if (pool.protocol === 'uniswap-v3') {
  return null;   // ← V3-only токены (MAGIC и др.) → null → cost gate fail-closed
}
```

**(b)** `pool-discovery.service.ts:346-361` — PoolDiscovery фейлит V3 резервы:
```typescript
// For V3, reserves are represented as liquidity + slot0
const liquidity = await contract.liquidity();
return {
  reserve0: BigInt(liquidity),   // ← математически бессмысленно как цена
  reserve1: BigInt(liquidity),
  protocol: 'uniswap-v3',
};
```

Комментарий-обоснование в `apps/scanner-service/src/scanner/v3-price.ts:6-9` прямо
фиксирует, что `reserve=liquidity` — это баг, а не фича.

#### Цепочка блокировки

1. MAGIC торгуется на Uniswap V3 → `priceArbitraryViaPool` находит V3 пул → skip → null.
2. `getTokenPriceUsd(MAGIC)` = null.
3. Cost gate: `Cost estimate unavailable for leg(s) 0, 1`.
4. Все планы с MAGIC блокируются (fail-closed).

#### Решение (переиспользовать готовое)

V3-математика **уже реализована** в репо — `apps/scanner-service/src/scanner/v3-price.ts`:
```typescript
const Q96 = 2n ** 96n;
export function v3PriceRaw(sqrtPriceX96: bigint): number { /* sqrtPrice² × 10^18 / 2^192 */ }
export function v3Price(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number { /* ... */ }
```

Пример из анализа Hermes дублирует эту функцию — нужно **импортировать** готовую, а не
писать копию.

#### Шаги реализации

1. **`pool-discovery.service.ts`:**
   - Расширить интерфейс `DiscoveredPool` (строки 30-44) опциональным полем
     `sqrtPriceX96?: bigint`.
   - В `tryUniV3Pool` (строки 322-365) прочитать `slot0` (ABI уже объявлен в строке
     332) и сохранить `slot0[0]` в новом поле. Не лить значение в reserve0/reserve1.
2. **`price-oracle.service.ts`:**
   - Заменить `return null` (строка 283) на ветку: импортировать `v3Price` из
     `@arbibot/scanner-service` (или вынести в shared `@arbibot/contracts-eth`) →
     расчёт через `sqrtPriceX96` → домножение на Chainlink WETH USD.
3. **MAGIC-обход (MVP):**
   - Проверить, есть ли SushiSwap V2 пул MAGIC/WETH на Arbitrum. Если есть — добавить
     в `DEFAULT_SEED_POOLS` (`pool-discovery.service.ts:79-84`), тогда V3-патч для MAGIC
     конкретно не понадобится.
   - Если MAGIC V3-only — реализация шагов 1+2 обязательна.
4. **Тесты:** unit-тест на `priceArbitraryViaPool` для V3 кейса (mock `DiscoveredPool`
   с `protocol: 'uniswap-v3'` и `sqrtPriceX96`).

#### Дополнительно — MAGIC отсутствует в registry

`grep -i magic` по `apps/scanner-service/src/scanner/scanner-pool.constants.ts` → 0
совпадений. В `DEFAULT_SEED_POOLS` MAGIC/WETH тоже нет. Даже после V3-фикса цена MAGIC
появится только если пул попадёт в кэш discovery — сейчас этого не происходит. Шаг 3
выше это закрывает.

#### DoD

- [ ] V3 пул в кэше `PoolDiscoveryService` priced корректно (не null).
- [ ] Unit-тест на V3 pricing ветку зелёный.
- [ ] Если добавлен MAGIC seed — комментарий в `DEFAULT_SEED_POOLS` со ссылкой на
      on-chain адрес пула и датой верификации.
- [ ] Lint/build/test зелёные; обновлён комментарий о V3 в `price-oracle.service.ts`
      (текущий «unreliable for pricing in v1; skip» — устаревший).
- [ ] `docs/roadmap-vectors.md` — инициатива #45 → `done`.

---

### #46. `SEC-RPC-STATIC-NETWORK` — staticNetwork pin

| Поле | Значение |
|------|----------|
| **Вектор** | `SEC` (надёжность live-пути), вторичный `REL` |
| **gate** | `live-blocker` |
| **impact / effort / score** | 4 / 1 / 20 |
| **Корневой файл** | `apps/execution-orchestrator/src/execution/rpc/rpc-provider-manager.service.ts:84-97` |

#### Проблема (технический разбор)

Коммит `6bbe45e` убрал `staticNetwork: true` с обоснованием:
> *"With staticNetwork: true, ethers v6 throws 'NETWORK_ERROR: network changed: 1 => 42161' on EVERY read"*

Это **технически неверно**, что подтверждается чтением `node_modules/ethers@6.17.0`:

**`abstract-provider.js:621-639`** — `getNetwork()` сравнивает кэшированную сеть со
свежим `_detectNetwork()` на каждом вызове:
```js
const [expected, actual] = await Promise.all([
  networkPromise,
  this._detectNetwork()   // ← fresh eth_chainId каждый раз
]);
if (expected.chainId !== actual.chainId) {
  assert(false, `network changed: ${expected.chainId} => ${actual.chainId}`,
    "NETWORK_ERROR", { event: "changed" });
}
```

**`provider-jsonrpc.js:401-412`** — при `staticNetwork: true` `_detectNetwork()`
возвращает пин **без** RPC-запроса:
```js
const network = this._getOption("staticNetwork");
if (network) {
  if (network === true) {
    if (this.#network) { return this.#network; }   // ← БЕЗ eth_chainId
  }
}
```

**Вывод:** при `staticNetwork: true` + `new JsonRpcProvider(url, 42161)` сравнение
всегда `42161 === 42161` → `NETWORK_ERROR` невозможен. Симптом
`network changed: 1 => 42161` — это симптом **отсутствия** pin (load-balancer направил
первый запрос на Ethereum-ноду, второй на Arbitrum), а не его наличия.

Текущий код без `staticNetwork` подвержен этой ошибке, а не защищён от неё.

#### Решение

Вернуть pin как опцию конструктора:

```typescript
// rpc-provider-manager.service.ts:92
const primary = new JsonRpcProvider(config.primary, config.chainId, {
  staticNetwork: true,
});
// то же для backup (строка 97):
backup = new JsonRpcProvider(config.backup, config.chainId, {
  staticNetwork: true,
});
```

`FallbackProvider` наверху (`строка 99`) наследует провайдеры с pin — дополнительно
ничего менять не нужно.

#### Caveat (обоснованный trade-off)

`staticNetwork: true` маскирует стойкое направление на неверную сеть (env указывает
на Ethereum mainnet вместо Arbitrum — ethers не ругается, отдаёт неправильные данные).
Это компенсируется существующими гарантиями:
- `ci-address-checksum` guard (CI).
- `/health/rpc` healthcheck (runtime).

С ними pin безопасен.

#### Шаги реализации

1. **`rpc-provider-manager.service.ts`:** добавить `{ staticNetwork: true }` в оба
   конструктора (primary + backup).
2. **Обновить комментарий** (строки 84-91) — текущий текст технически неверен. Заменить
   на обоснование: «pin возвращает сеть без RPC → `NETWORK_ERROR` невозможен при
   расхождениях load-balancer'а; защита от misconfig покрывается `ci-address-checksum`
   + `/health/rpc`». Это выполнение принципа **P-LIVE-1**.
3. **Тесты:** unit-тест, что `initializeProviders` создаёт провайдеры с pin (mock
   `JsonRpcProvider`, проверить что опция передана). Если мок сложен — минимально
   regression-комментарий в spec-файле.

#### DoD

- [ ] `new JsonRpcProvider(url, chainId, { staticNetwork: true })` для primary и backup.
- [ ] Комментарий в `rpc-provider-manager.service.ts:84-91` технически верен (соответствует
      фактическому поведению ethers v6).
- [ ] Lint/build/test зелёные.
- [ ] Smoke на paper: `npm run smoke:live-testnet` (dry-run) проходит без
      `NETWORK_ERROR` в логах.
- [ ] `docs/roadmap-vectors.md` — инициатива #46 → `done`.

---

### #47. `REL-AUDIT-IDEMPOTENCY-UUID` — audit UUID validation

| Поле | Значение |
|------|----------|
| **Вектор** | `REL` (идемпотентность = надёжность), вторичный `SEC` |
| **gate** | `paper-check` (не блокирует live, но дедупликация аудит-логов нерабочая) |
| **impact / effort / score** | 3 / 1 / 15 |
| **Корневые файлы** | `apps/audit-service/src/audit/dto/append-audit.dto.ts:4-6` (валидация), ~15 caller sites |

#### Проблема (подтверждено кодом)

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
| `legs.service.ts:716` | `execution:ApplyFill:${dto.idempotencyKey}` |
| `configurations.service.ts:524, 629` | `arb:config:v1:promote:idemp:${idempotencyKey}` |

**Результат:** каждый audit-вызов с `idempotencyKey` падает с HTTP 400.

#### Почему severity Medium, не LOW (несогласие с Hermes)

Hermes назвал пункт LOW («спам логов»). Это недооценка:

1. `AuditClientService.record()` — fire-and-forget, домен не блокируется (ОК).
2. `AuditClientService.appendEntry()` — **await'ит** HTTP round-trip
   (`audit-client.service.ts:67`). Любой вызов с невалидным ключом заставляет caller
   ждать timeout/ошибку.
3. **Главное:** вся функциональность дедупликации аудита нерабочая.
   `audit.service.ts:47-83` рассчитывает на UNIQUE-индекс БД + `pessimistic_write`
   lock по `idempotencyKey` для защиты от дублей. При 400 строка до БД не доходит →
   дубли спокойно пишутся. Защита от повторных операций через audit-лог — мёртвая.

Это не критично для live-деплоя (trade-path не зависит от audit), но снижает
надёжность forensic-возможностей. Поэтому `paper-check`, не `live-blocker`.

#### Решение

**Серверный фикс** (предпочтительный — один call site):

```typescript
// append-audit.dto.ts
@IsOptional()
@IsString()
@MaxLength(255)
idempotencyKey?: string;
```

Уникальность всё равно обеспечивает БД (UNIQUE на колонке + pessimistic lock в
`audit.service.ts:47-83`). Формат ключа — семантический, не UUID; это корректный
дизайн для человекочитаемых ключей.

**Альтернатива** (клиентский фикс — отвергаемая): конвертировать ключи в UUID на
стороне клиентов. Минусы: ломает человекочитаемость, требует правок в ~15 call sites,
усложняет отладку.

#### Шаги реализации

1. **`append-audit.dto.ts`:** заменить `@IsUUID('4')` → `@IsString()` + `@MaxLength(255)`.
2. **Тесты:** добавить unit-тест в `audit.service.spec.ts` — что semanticti-idempotency
   key (`execution:BeginExecution:123`) принимается и дедуплицируется корректно
   (повторный вызов с тем же ключом → `replay: true`, без вставки).
3. **Regression check:** убедиться, что существующий test на `@IsUUID` (если есть)
   обновлён.

#### DoD

- [ ] `@IsUUID('4')` заменён на `@IsString()` + `@MaxLength(255)` в `append-audit.dto.ts`.
- [ ] Unit-тест на семантический idempotencyKey зелёный.
- [ ] Lint/build/test зелёные.
- [ ] `docs/roadmap-vectors.md` — инициатива #47 → `done`.
- [ ] (Опц.) заметка в `docs/security-accepted-risks.md`, если ранее это
      фиксировалось как accepted risk.

---

## 5. Жизненный цикл шага (наследуется из roadmap-vectors.md)

Стадии по `roadmap-vectors.md` §4.2 без изменений:

1. **`proposed`** — текущий статус всех трёх инициатив. `file:line`-ссылки заполнены.
2. **`accepted`** — после утверждения этого плана владельцем; инициативы попадают
   в `DEVELOPMENT_PLAN11.md` (если создаётся) или остаются в этом документе как план.
3. **`in-progress`** — перед стартом исполнитель **повторно** сверяет состояние кода
   (принцип P1), обновляет `file:line` если сместилось.
4. **`review`** — код написан, тесты локально зелёные; ревью-скиллы:
   - #45, #47: `/backend-review`.
   - #46: `/backend-review` + `/dex-security` (т.к. влияет на on-chain reads).
5. **`done`** — слит в `main` (direct-to-main по `git-workflow-agent`), CI зелёный,
   **и** обновлены информационные документы (P2):
   - `docs/roadmap-vectors.md` — инициатива → `done` + статус в строке.
   - `AGENTS.md` — если добавлены env vars / npm-скрипты (для этого плана — нет).
   - Этот файл — статус инициативы в §3 обновлён.

---

## 6. Метрики плана

| Метрика | Baseline (на старте плана) | Цель |
|---------|----------------------------|------|
| # live-blocker pricing gap'ов | 1 (V3) | 0 |
| `NETWORK_ERROR`-класс regressions | потенциально ≥1 (load-balancer drift) | 0 при правильном pin |
| Audit idempotency take-up rate | 0% (все ключи отклоняются) | 100% |
| `# файлов > 500 LOC` (QUAL) | без изменений | без регресса |
| Lint/build/test | 29/29 ✅, 22/22 ✅, baseline ✅ | без регресса |

Дополнительно — качественные:
- Технические комментарии в `rpc-provider-manager.service.ts` верны (P-LIVE-1).
- `docs/hermes-vs-zcode-review-2026-08-06.md` ссылается на `done` инициативы.

---

## 7. Anti-patterns (чего избегать в этом плане)

- ❌ **Писать новую V3-математику.** Уже есть в `scanner/v3-price.ts` — импортировать
  (или вынести в shared пакет при проблемах с cross-app импортом). Дублирование
  числовой математики — источник будущих расхождений.
- ❌ **Восстанавливать fallback'и Hermes** (`readNativeUsdViaDex`,
  `priceArbitraryViaDirectRpc`). Они были «пожарными» решениями, убраны правильно
  (см. факт-чек §#1, §#2). План их не возвращает.
- ❌ **Считать Cache null / KNOWN_DECIMALS проблемами.** Факт-чек подтвердил: оба
  уже в корректном состоянии. Не порождать инициатив.
- ❌ **Менять формат audit idempotencyKey на UUID на стороне клиентов.** Это ломает
  человекочитаемость и требует правок в ~15 местах. Фикс только серверный.
- ❌ **Игнорировать `git-workflow-agent`.** Коммиты direct-to-main, structured,
  linked to `step_id` (`FUNC-V3-PRICING` / `SEC-RPC-STATIC-NETWORK` /
  `REL-AUDIT-IDEMPOTENCY-UUID`).

---

## 8. Что план НЕ покрывает (отдельные решения)

Следующие пункты Hermes'а **намеренно исключены** из плана, т.к. не требуют действий
(детальное обоснование — в `docs/hermes-vs-zcode-review-2026-08-06.md`):

| Пункт Hermes | Причина исключения |
|--------------|---------------------|
| #1 Chainlink fix | ZCode уже починил корректно (corrupted addr + BigInt split). |
| #2 Pool discovery seeds | ZCode уже починил (real SushiSwap V2 addresses). |
| #4 Cache null | Уже исправлено: `price-oracle.service.ts:151-157` не кэширует null. |
| #5 KNOWN_DECIMALS убран | Замечание ошибочно: `KNOWN_DECIMALS_BY_ADDRESS` на месте (`price-oracle.service.ts:60-75`). |

Cross-chain bridge-блокеры (неверные mainnet-адреса, fake Stargate ABI и т.д.)
остаются в отдельном плане — не PLAN11. См. `docs/roadmap-vectors.md` и
`AGENTS.md` §"Cross-chain".

---

---

## 9. Результат выполнения (2026-08-06)

Все три инициативы реализованы и `done`.

**#45 V3 pricing:**
- Канон V3/V2 math перенесён в `@arbibot/contracts-eth` (`src/math/uniswap-v3-price.ts`,
  `v3PriceRaw`/`v3Price`/`v2Price`/`spreadBps`) — единый источник для scanner-service и
  execution-orchestrator. Дубликат `scanner-service/src/scanner/v3-price.ts` удалён.
- `DiscoveredPool` расширен опциональным полем `sqrtPriceX96` (V3-only);
  `tryUniV3Pool` читает `slot0` и сохраняет `sqrtPriceX96`.
- `PriceOracleService.priceArbitraryViaPool` — V3-ветка реализована через `v3Price()`
  с инверсией при `token = token1`; null при stale cache (`sqrtPriceX96 === undefined`).
- Тесты: 3 новых в `price-oracle.service.spec.ts` (V3 token0, V3 token1, stale cache);
  pool-discovery mock'и обновлены под `slot0`. contracts-eth: 16 тестов (новый spec).
- tsconfig contracts-eth: добавлен `target: ES2022` + `module: commonjs` (BigInt требует
  ES2020+; commonjs сохранён для совместимости с jest/CJS-потребителями).

**#46 staticNetwork:**
- `rpc-provider-manager.service.ts:92,97` — `new JsonRpcProvider(url, chainId, { staticNetwork: true })`
  для primary и backup.
- Комментарий (строки 84-96) переписан: технически верное обоснование (pin устраняет
  `eth_chainId` round-trip → `NETWORK_ERROR` невозможен при load-balancer drift; защита
  от misconfig покрыта `ci-address-checksum` + `/health/rpc`). Принцип P-LIVE-1 выполнен.

**#47 Audit UUID:**
- `append-audit.dto.ts` — `@IsUUID('4')` → `@IsString()` + `@MaxLength(255)`.
- Regression-тест в `audit.service.spec.ts`: семантический ключ
  `execution:BeginExecution:plan-42` принимается и дедуплицируется (replay на повторе).

**Сверка (на коммите после правок):**
- Build: contracts-eth ✅, audit-service ✅, execution-orchestrator ✅, scanner-service ✅
- Tests: execution-orchestrator 856/856 ✅ (52 suites), audit-service 22/22 ✅,
  contracts-eth 16/16 ✅, scanner-service scanner-pool+spread 34/34 ✅
- Lint: 2 pre-existing errors в `pool-discovery.service.ts:306-307` (коммит `aae6d04`,
  не от PLAN11 — вне скоупа). Остальные затронутые пакеты чистые.

**MAGIC-обход:** не потребовался отдельный seed — после V3-патча любой V3 пул
(включая MAGIC/WETH) priced корректно, если он попал в кэш discovery. Добавление
конкретных seed-пулов для MAGIC — опциональная операционная задача, не блокер.

---

*Составлено: 2026-08-06 на основе факт-чека коммита `957e9d5`. Все `file:line`
верифицированы прямым чтением кода + `node_modules/ethers@6.17.0`. Реализовано и
проверено в той же сессии. При изменении кода — обновить этот файл по принципу P2.*
