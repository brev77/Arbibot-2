# Задача: D4-B-2d — wire evaluateTrade() + recordTradeVolume() в 5 DEX-адаптерах

**План:** `DEVELOPMENT_PLAN4.md` → Фаза B → шаг `D4-B-2-LIMITS` (L2 🔴)
**Под-шаг:** 2d из 4 (последний) — после него `D4-B-2-LIMITS` → `done` (11/22 шагов плана)
**Зависимости:** 2a ✅, 2b ✅, 2c ✅ (все закоммичены)

---

## Прогресс D4-B-2 (под-шаги)

| Под-шаг | Суть | Статус | Коммит |
|---------|------|--------|--------|
| 2a | config-service reader (dex.limits/dex.live) + daily-volume в БД | ✅ done | `e2dd527` |
| 2b | PriceOracleService (stables→$1, WETH→Chainlink, arbitrary→pool) | ✅ done | `27ff8eb` |
| 2c | live-DEX path glue (extractVenueKey/extractSwapParams читают config.legs[]) | ✅ done | `368e50e` |
| **2d** | **wire evaluateTrade() + recordTradeVolume() в 5 DEX-адаптерах** | ⬜ **СЛЕДУЮЩИЙ** | — |

---

## Контекст — что уже сделано (предпосылки для 2d)

### 2a — `DexRiskPolicyService` готов к вызову
- `evaluateTrade(params)` — **async**, читает config-service `dex.limits` (кэш 10s), проверяет daily-volume из БД.
  - `apps/execution-orchestrator/src/execution/risk/dex-risk-policy.service.ts:170`
  - **Сигнатура params:** `{ chainId, pool?, amountInUsd, estimatedSlippageBps, estimatedGasCostUsd, tokenIn, tokenOut }`
  - **Возвращает:** `{ allowed, reasons[], warnings[], estimatedSlippageBps, estimatedGasCostUsd, poolLiquidityUsd }`
  - `pool` — optional (в 2d можно опустить; price oracle для poolLiquidityUsd добавляется позже).
- `recordTradeVolume(chainId, volumeUsd)` — atomic UPSERT в `dex_daily_volume`.
  - `dex-risk-policy.service.ts:258`. Non-fatal (логирует при ошибке, не роняет swap).

### 2b — `PriceOracleService` готов к вызову
- `getTokenPriceUsd(chainId, tokenAddress): Promise<number | null>`
  - `apps/execution-orchestrator/src/execution/price/price-oracle.service.ts`
  - Возвращает `null` если цена не разрешена (RPC down / нет пула). **Fail-state → null.**
- Зарегистрирован в `execution.module` providers + exports.

### 2c — swap-поля доступны в адаптерах
- `extractSwapParams` / `extractSwapParamsV3` теперь возвращают `DexSwapParams` с `chainId, tokenIn, tokenOut, amountIn, slippageBps?, recipient?, deadlineSeconds?` (+ V3: `fee, amountOutExpected, sqrtPriceLimitX96?`).
- Эти поля приходят из `playbookConfig.legs[legIndex]` (multi-leg builder format).

---

## Задача 2d — точно

### A. Wire `evaluateTrade()` в 5 live DEX-адаптерах (перед `selectWallet`)

В каждом из 5 live адаптеров, **после `extractSwapParams` и до `selectWallet`**, вставить risk-gate:

1. Разрешить USD цену `tokenIn` через `PriceOracleService.getTokenPriceUsd(params.chainId, params.tokenIn)`.
   - Если `null` → **throw `VenueSubmitClientError`** (`category: 'semantic'`, «cannot price tokenIn for live risk check»). Fail-closed: live leg не broadcast без оценки капитала.
2. Вычислить `amountInUsd = (Number(BigInt(params.amountIn)) / 10 ** tokenInDecimals) * tokenInUsd`.
   - `tokenInDecimals` — через ERC20 `decimals()` (или cached). Можно использовать `Contract(tokenIn, ERC20ABI, provider).decimals()`.
3. Вызвать `evaluateTrade({ chainId: params.chainId, amountInUsd, estimatedSlippageBps: params.slippageBps ?? getSlippageBps(), estimatedGasCostUsd: 0, tokenIn: params.tokenIn, tokenOut: params.tokenOut })`.
4. При `risk.allowed === false` → **throw `VenueSubmitClientError`** (`category: 'semantic'`, `DEX risk denied: ${risk.reasons.join('; ')}`). Leg остаётся в `created` (retryable).

### B. Wire `recordTradeVolume()` после успешного swap

После успешного `tx.wait()` (где это уже есть в адаптерах), вызвать:
```ts
await this.dexRiskPolicy.recordTradeVolume(params.chainId, amountInUsd)
  .catch(() => { /* non-fatal; логирует внутри */ });
```
`amountInUsd` — тот же, что вычислен в шаге A (вынести в переменную выше по scope).

### C. DI регистрация

Каждый из 5 live адаптеров получает 2 новых constructor-зависимости:
- `DexRiskPolicyService` (из `../risk/dex-risk-policy.service`)
- `PriceOracleService` (из `../price/price-oracle.service`)

Адаптеры уже зарегистрированы в `execution.module` providers — обновить **только constructor signature** каждого адаптера (Nest DI разрешит автоматически, т.к. оба сервиса уже в providers+exports модуля).

### D. Paper isolation (критично)

**`PaperDexAdapter` НЕ получает `evaluateTrade` / `recordTradeVolume` / `PriceOracleService`.**
Структурная изоляция paper/live: paper legs никогда не должны достигать live risk-gate.
- `apps/execution-orchestrator/src/execution/adapters/paper-dex.adapter.ts` — оставить как есть (он использует `extractSwapParams` только для симуляции, без live submit).

---

## Точные call sites (из разведки 2c)

Все 5 live адаптеров имеют `submitLeg(plan, leg)` с одинаковой структурой:

| Адаптер | Файл | `extractSwapParams` | `selectWallet` | `tx.wait()` успех |
|---------|------|---------------------|-----------------|-------------------|
| UniswapV2Adapter | `execution/adapters/uniswap-v2.adapter.ts` | :249 | :262 | далее по файлу |
| UniswapV3Adapter | `execution/adapters/uniswap-v3.adapter.ts` | :247 (`extractSwapParamsV3`) | :261 | далее |
| SushiSwapV2Adapter | `execution/adapters/sushiswap-v2.adapter.ts` | :147 | далее | далее |
| PancakeSwapV2Adapter | `execution/adapters/pancakeswap-v2.adapter.ts` | :119 | далее | далее |
| BiswapV2Adapter | `execution/adapters/biswap-v2.adapter.ts` | :106 | далее | далее |

`extractSwapParams` экспортирован из `uniswap-v2.adapter.ts` и переиспользуется sushi/pancake/biswap — поэтому **правка insert-точки одинакова во всех 5**.

**Точка вставки evaluateTrade** — между строкой `extractSwapParams(...)` и `selectWallet(...)` в каждом адаптере (после логгинга «submitLeg: ...», до wallet selection).

---

## Паттерны из кодовой базы (образцы для копирования)

### Risk-gate блок (вставлять в каждый live адаптер)
```ts
// D4-B-2d: live risk gate — evaluateTrade before wallet selection
const tokenInUsd = await this.priceOracle.getTokenPriceUsd(params.chainId, params.tokenIn);
if (tokenInUsd === null) {
  throw new VenueSubmitClientError(
    `${adapterName}: cannot price tokenIn ${params.tokenIn} on chain ${params.chainId} — live risk check blocked`,
    { category: 'semantic' },
  );
}
// tokenInDecimals — ERC20 read (chain-specific). См. образец в PriceOracleService.getTokenDecimals.
const tokenInDecimals = await this.readDecimals(provider, params.tokenIn);
const amountInUnits = Number(BigInt(params.amountIn)) / 10 ** tokenInDecimals;
const amountInUsd = amountInUnits * tokenInUsd;

const risk = await this.dexRiskPolicy.evaluateTrade({
  chainId: params.chainId,
  amountInUsd,
  estimatedSlippageBps: params.slippageBps ?? getSlippageBps(),
  estimatedGasCostUsd: 0, // до gas estimation; можно уточнить после estimateGas если нужно
  tokenIn: params.tokenIn,
  tokenOut: params.tokenOut,
});
if (!risk.allowed) {
  throw new VenueSubmitClientError(
    `${adapterName}: DEX risk denied: ${risk.reasons.join('; ')}`,
    { category: 'semantic' },
  );
}
```

### recordTradeVolume (после tx.wait() успеха)
```ts
// D4-B-2d: record volume for daily-limit tracking (non-fatal)
await this.dexRiskPolicy.recordTradeVolume(params.chainId, amountInUsd)
  .catch(() => { /* логирует внутри; swap уже broadcast */ });
```

### ERC20 decimals read (вспомогательный метод в адаптере или общий util)
См. `PriceOracleService.getTokenDecimals` (`price-oracle.service.ts`) — там кэшированный read через `new Contract(token, ERC20ABI, provider).decimals()`. Можно вынести в общий helper или дублировать (decimals кэшируется в PriceOracleService — но это другой экземпляр; для simplicity сделать локальный read в адаптере, либо прокидывать decimals через PriceOracleService как публичный метод).

---

## Acceptance criteria

- [ ] `evaluateTrade()` вызывается во всех **5 live** DEX-адаптерах перед `selectWallet`
- [ ] При `allowed === false` → throw `VenueSubmitClientError`, leg не broadcast (остаётся retryable)
- [ ] При неразрешимой цене tokenIn (oracle → null) → throw (fail-closed)
- [ ] `recordTradeVolume(chainId, amountInUsd)` вызывается после успешного swap (non-fatal)
- [ ] `PaperDexAdapter` **НЕ** вызывает `evaluateTrade` (paper/live изоляция — unit test)
- [ ] Метрика `arb_dex_risk_checks_total{result=allowed|blocked}` инкрементируется (уже внутри evaluateTrade)
- [ ] Bridge legs не gated через evaluateTrade (только kill-switch + finality) — структурно: bridge adapters не трогаются

## Тесты (минимум)

В spec-файле каждого live адаптера (уже существуют `uniswap-v2.adapter.spec.ts` и т.д.):
1. `evaluateTrade` возвращает `allowed:false` → `submitLeg` rejects с «DEX risk denied», wallet NOT selected, tx NOT sent.
2. `evaluateTrade` возвращает `allowed:true` → `submitLeg` proceeds (как раньше).
3. `priceOracle.getTokenPriceUsd` → `null` → `submitLeg` rejects с «cannot price tokenIn».
4. После успешного swap → `recordTradeVolume` вызван с правильным `(chainId, amountInUsd)`.

Mock-паттерн для `DexRiskPolicyService`:
```ts
const mockDexRiskPolicy = {
  evaluateTrade: jest.fn().mockResolvedValue({ allowed: true, reasons: [], warnings: [], estimatedSlippageBps: 0, estimatedGasCostUsd: 0, poolLiquidityUsd: 0 }),
  recordTradeVolume: jest.fn().mockResolvedValue(undefined),
};
const mockPriceOracle = {
  getTokenPriceUsd: jest.fn().mockResolvedValue(2500), // ETH @ $2500
};
// добавить в providers адаптера в Test.createTestingModule
```

Для paper isolation — добавить тест в `paper-dex.adapter.spec.ts` (если есть) или новый: убедиться что `DexRiskPolicyService` **не в DI** PaperDexAdapter.

---

## Test commands

```bash
npm test -w @arbibot/execution-orchestrator        # ожидается ~470+ тестов (461 + новые 2d)
npm run build -w @arbibot/execution-orchestrator
npm run lint -w @arbibot/execution-orchestrator
```

## Коммит

**Direct-to-main** (политика зафиксирована в `CONTRIBUTING.md` + `.cursor/skills/git-workflow-agent/SKILL.md`).

Формат сообщения:
```
feat(D4-B-2d): wire evaluateTrade + recordTradeVolume in 5 live DEX adapters

Sub-step 2d of D4-B-2-LIMITS (L2). Closes L2: every live DEX swap now passes
through the risk gate (evaluateTrade) before wallet selection and records traded
volume (recordTradeVolume) after success. Paper path structurally unaffected.

- evaluateTrade() wired before selectWallet in: uniswap-v2, uniswap-v3,
  sushiswap-v2, pancakeswap-v2, biswap-v2.
- recordTradeVolume() after successful tx.wait() in all 5.
- Fail-closed: unresolved tokenIn price (oracle null) → throw, no broadcast.
- PaperDexAdapter untouched (paper/live isolation).
...
```

После коммита 2d:
1. Обновить `.cursor/plans/DEVELOPMENT_PLAN4.md` — `D4-B-2-LIMITS` → `done` (11/22).
2. Обновить `docs/adr-live-gate.md` §2 — отметить implementation complete.

---

## Архитектурные инварианты (проверить перед коммитом)

- **Single-writer:** `DexRiskPolicyService` — единственный writer `dex_daily_volume`; адаптеры только вызывают его методы.
- **Fail-closed:** неразрешимая цена / denied trade → блок live, paper продолжается.
- **Paper/live isolation:** `evaluateTrade` только в live адаптерах; `PaperDexAdapter` не имеет этой зависимости.
- **Latency budget:** evaluateTrade `<10ms` (cached config + DB read); price oracle `<10s` TTL кэш.
- **Bridge legs:** gated через kill-switch (D4-B-1) + finality (D4-B-5), НЕ через evaluateTrade.

## Связанные артефакты

- ADR: [`docs/adr-live-gate.md`](adr-live-gate.md) §2 (dex.limits/dex.live consumption)
- Шаг плана: [`.cursor/plans/deploy-readiness/D4-B-2-LIMITS.md`](../.cursor/plans/deploy-readiness/D4-B-2-LIMITS.md)
- Пред. под-шаги: `git show e2dd527` (2a), `git show 27ff8eb` (2b), `git show 368e50e` (2c)
- Threat model: `.cursor/skills/dex-security-and-capital-safety/references/threat-model.md` (C1, C2)

---

*Создано как самодостаточная задача для следующей сессии. Прочитай этот файл + `git show 368e50e` (2c, последний коммит) для полного контекста, затем приступай.*
