# Журнал изменений Hermes Agent (сервер Aéza)

> **Источник:** `/root/hermes-changelog.md` на хосте `arbibot-paper` (79.137.202.225).
> **Архивировано:** 2026-08-09 (PLAN12 #4) — дословная копия серверного журнала + раздел
> сверки ZCode в конце. Серверный оригинал живёт вне git; эта копия — канон для аудита.
> **Правило журнала (из шапки оригинала):** Все изменения, проведённые Hermes на сервере,
> записываются в этот файл. Формат: Дата МСК | Что изменено | Для чего.

---

## 2026-08-06 18:00 МСК — Создание журнала

**Что:** Создан файл `/root/hermes-changelog.md`
**Для чего:** Фиксация всех изменений Hermes на сервере для прозрачности и передачи в Cursor (ZCode)

---

## 2026-08-06 18:12 МСК — Включён AUTO_DRIVE_INTERVAL_MS=3000

**Что:** Добавлено `AUTO_DRIVE_INTERVAL_MS=3000` в `.env`, opportunity-service перезапущен
**Для чего:** Paper AutoDriveWorker (detected→risk_checked) был выключен — `AUTO_DRIVE_INTERVAL_MS unset or 0`. 43 opportunities застряли в `detected`, ни один не переходил в `risk_checked`. LiveAutoDriveWorker берёт только `risk_checked` → простаивал. Включение paper auto-drive разблокирует поток данных к live pipeline.

---

## 2026-08-06 18:20 МСК — Добавлен WBTC/WETH в DEFAULT_SEED_POOLS

**Что:** Добавлен WBTC/WETH UniV3 (0.05%) пул `0x2f5e87C9312fa29aed5c179E456625D79015299c` в `DEFAULT_SEED_POOLS` (pool-discovery.service.ts), EO пересобран и перезапущен
**Для чего:** UniV3 adapter падал с `cannot price tokenIn 0x2f2a... (WBTC) — live risk check blocked`. WBTC/WETH пул отсутствовал в seed pools → PriceOracle не мог найти цену WBTC → adapter блокировал. Теперь warm-up = 10/10 пулов (3 V2 + 7 V3).

---

## 2026-08-06 18:30 МСК — Очистка зависших планов

**Что:** 3 execution plans переведены в `failed`, 3 opportunities очищены от `live_execution_plan_id`
**Для чего:** 3 зависших плана (в состоянии `executing`) занимали слоты `maxConcurrentPlans=3`. LiveAutoDriveWorker не создавал новые планы — думал что лимит исчерпан. Очистка освобождает слоты для новых сделок.

---

## 2026-08-06 18:40 МСК — Аудит: selectWallet зависает (блокер найден)

**Что:** Проведён анализ кода после включения платного BlockPi RPC
**Результат:** Pipeline доходит до `risk_gate_passed` → `selectWallet` (зависает) → legs уходят в `submitting` → reaper убивает через 5 мин
**Корневая причина:** `KeyVaultService initialized (persistence: in-memory fallback)` — `WALLET_KEY_STORE` DI token не резолвится. `metaCache` пустой (0 ключей). `getWalletKeysByChain(42161)` возвращает `[]` → `selectWallet` не может выбрать кошелёк.
**Для чего:** Ранее считалось что проблема в RPC latency. Доказано по логам: KeyVault работает in-memory, не БД. ТЗ создано: `tz-keyvault-in-memory.md`.

---

## 2026-08-06 19:00 МСК — Фикс KeyVault in-memory fallback

**Что:**
1. `packages/nest-platform/src/vault/key-vault.service.ts` — добавлен метод `attachStore()` для поздней привязки store + `hydrateFromStore()`
2. `apps/execution-orchestrator/src/execution/wallet-key-store.typeorm.ts` — добавлен `OnModuleInit`, конструктор инжектит `KeyVaultService`, `onModuleInit` вызывает `keyVault.attachStore(this)`
3. `apps/execution-orchestrator/src/execution/execution.module.ts` — `useFactory` reverted на `useExisting` (не помог, но метод attachStore решает проблему)

**Для чего:** NestJS DI order: `@Global KeyVaultModule` инстанцирует `KeyVaultService` до того, как `ExecutionModule` регистрирует `WALLET_KEY_STORE`. `@Optional()` inject возвращает undefined → in-memory fallback. Late-bind через `attachStore` гарантирует подключение TypeORM store после инициализации всех модулей.

**Результат:**
```
KeyVaultService: Loaded 1 wallet key(s) from store
KeyVaultService: store attached late (persistence: wallet_keys table). Loaded 1 key(s).
TypeOrmWalletKeyStore: attached to KeyVaultService
```
Кошелёк `prod-arb-1` (0xDea3...) теперь в `metaCache`.

---

## 2026-08-06 19:10 МСК — Новый блокер: decrypt private key failed

**Что:** После фикса KeyVault, pipeline дошел до `selectWallet` → `decryptPrivateKey` → `Unsupported state or unable to authenticate data` (AES-256-GCM auth failure)
**Причина:** `wallet-key-import.mjs` использует `Buffer.from(deploySalt, 'utf8')` для combined salt, но `KeyVaultService.decryptPrivateKey` использует `Buffer.from(encryptedKey.salt, 'hex')`. Несоответствие кодировки salt.
**Ре-импорт:** Удалена старая запись, ключ ре-импортирован через `tools/wallet-key-import.mjs`.
**Результат:** Ре-импорт не помог — та же ошибка. Корневая причина в несоответствии формата salt между import tool и KeyVaultService.

---

## 2026-08-06 19:25 МСК — Фикс decrypt: ре-импорт с env переменными через `source .env`

**Что:** Ре-импорт кошелька через `source .env` для гарантии что PRIVATE_KEY_ENCRYPTION_KEY и VAULT_MASTER_KEY_SALT подгружены
**Для чего:** Предыдущий ре-импорт запускался без `source .env` — переменные могли быть не загружены
**Результат:** Тот же блокер — проблема в кодировке salt

---

## 2026-08-06 19:40 МСК — Фикс расшифровки: reencrypt-key.mjs

**Что:**
1. Создан `tools/reencrypt-key.mjs` — шифрует ключ тем же алгоритмом что `KeyVaultService.encryptPrivateKey` (double-scrypt с разделёнными salts)
2. `wallet-key-import.mjs` использовал single-scrypt с combined salt — несовместимо с сервисом
3. БД запись обновлена новым ciphertext

**Результат:** ✅ Ключ расшифровывается! Pipeline дошёл до:
- `risk_gate_passed` ✅
- `wallet_selected address=0xDea3...` ✅
- `approval_confirmed` ✅
- `amount_out_min` ✅
- ❌ `live slippage gate blocked — real price impact 9998 bps exceeds max 50 bps`

**Новый блокер:** Slippage gate блокирует — amountIn=253 MAGIC (256 quintillion wei) → price impact 9998 bps. Причина: amountIn в wei для SushiSwap sell leg рассчитан неверно (pre-quoted модель, sell amountIn = buy amountOutExpected в raw units).

---

## 2026-08-06 20:00 МСК — ТЗ: Slippage gate — pre-quoted sell amountIn

**Что:** Создано ТЗ `tz-slippage-gate-amountin.md` на основе полного анализа кодовой базы
**Анализ:**
- `token-resolver.service.ts:266-286` — `computeAmountIns` рассчитан верно (253 MAGIC)
- `plan-setup-orchestrator.service.ts:138-139` — amountIns передаются правильно
- SushiSwap adapter логирует `expectedAmountOut=1729` вместо ожидаемых `10000000` (10 USDC)
- `enforcePostQuoteSlippageGate` считает 9998 bps из-за неверного expectedOut

**Корневая причина:** Значение `expectedAmountOut=1729` появляется где-то между `plan-setup-orchestrator` и `extractSwapParamsV2` — нужно проверить `playbookConfig` в БД и `extractSwapParamsV2`.

---

## 2026-08-06 20:15 МСК — Фикс: minLiquidityUsd=5000 (ОШИБКА — ОТМЕНЁН)

**Что:** Установлен `minLiquidityUsd=5000` в scanner.instances конфиг
**Корневая причина slippage 9998 bps:** Сканер находил спред между нормальным UniV3 пулом и **мёртвым** SushiSwap пулом (0.038 MAGIC / 0.0017 USDC).
**Анализ кода `scanner-filter.service.ts:67-74`:** `minLiquidityUsd` — это НЕ минимальная ликвидность пула. Это фильтр чистой прибыли: `Math.max(0, spread.netProfitUsd) < minLiquidityUsd`. При `5000` бот отбросит ВСЕ сделки (реальная прибыль $1-10, а не $5000).
**ОТМЕНА:** `minLiquidityUsd` возвращён к `0`. Проблема мёртвых пулов требует другого решения — фильтр по реальным резервам пула, а не по netProfitUsd.

---
---

## Сверка ZCode (добавлено при архивации, 2026-08-09)

Каждый пункт журнала сверен с кодом канон-репозитория (чтение исходников, не комментариев).
Итоги сверки:

| Время МСК | Действие Hermes | Вердикт сверки | Статус в каноне |
|-----------|-----------------|----------------|-----------------|
| 18:12 | `AUTO_DRIVE_INTERVAL_MS=3000` env | env-only, корректно | не в git (operational) |
| 18:20 | WBTC/WETH seed pool | ✅ подтверждено on-chain (PLAN12 #3) | **портировано** `pool-discovery.service.ts` |
| 18:30 | Очистка зависших планов | data-only, корректно | не требует кода |
| 18:40 | Аудит selectWallet | ✅ симптом реальный | — |
| 19:00 | `attachStore()` late-bind | ❌ **обход**; реальная причина — баг VISIBILITY (не DI-order) | **НЕ перенесён**; заменён PLAN12 #1 (`@Global WalletKeyStoreModule`) |
| 19:00 | `useFactory → useExisting` | ❌ **неверно описано**: `useFactory` никогда не был в каноне; `useExisting` уже стоял | канон unchanged |
| 19:10 | «несоответствие кодировки salt» | ❌ **неверный диагноз**: реальная причина — single vs double scrypt | — |
| 19:40 | `reencrypt-key.mjs` | ⚠️ обход; корень не починен | **НЕ перенесён**; заменён PLAN12 #2 (double-scrypt в `wallet-key-import.mjs`) |
| 20:00 | ТЗ slippage gate | ❌ **гипотеза опровергнута кодом + БД**: `expectedAmountOut=1729` — живой on-chain quote от мёртвого пула, а не пересчёт в адаптере; gate работает правильно | см. `tz-slippage-gate-amountin-2026-08-06.md` |
| 20:15 | `minLiquidityUsd=5000` | ✅ сам Hermes отменил (фильтр netProfit, не ликвидности) | не применимо |

**Ключевые выводы сверки:**
1. Гермес верно идентифицировал **симптомы** (3 live-блокера), но в 2 из 3 случаев дал **неверный диагноз корня**.
2. Баг VISIBILITY (`WALLET_KEY_STORE` в non-`@Global` `ExecutionModule`, невидим `KeyVaultService`) замаскирован обходом `attachStore()` — правильно чинить DI-scope, не позднюю привязку.
3. Баг scrypt (single vs double pass) замаскирован `reencrypt-key.mjs` — правильно чинить `wallet-key-import.mjs`, не ре-шифровать.
4. Slippage gate работает как задумано (fail-closed на мёртвых пулах) — правки gate не нужны; реальная проблема в scanner-service (фильтр пулов по резервам), это отдельный план.

См. также: [`docs/tz-keyvault-in-memory-2026-08-06.md`](tz-keyvault-in-memory-2026-08-06.md),
[`docs/tz-slippage-gate-amountin-2026-08-06.md`](tz-slippage-gate-amountin-2026-08-06.md).
