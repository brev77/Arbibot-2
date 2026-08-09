# ТЗ: KeyVault in-memory fallback — кошелёк не загружается из БД

> **Источник:** `/root/tz-keyvault-in-memory.md` на хосте `arbibot-paper`.
> **Архивировано:** 2026-08-09 (PLAN12 #4) — дословная копия серверного ТЗ + раздел
> сверки ZCode в конце. ТЗ написано Hermes 2026-08-06; диагноз «DI order» ниже —
> **неверный** (см. раздел сверки: реальная причина — token VISIBILITY).

**Дата:** 6 августа 2026
**Автор:** Hermes Agent
**Приоритет:** 🔴 CRITICAL — блокирует все live-сделки
**Коммит:** `8da84f3`

---

## Проблема

Pipeline доходит до `submitLeg` → `risk_gate_passed` → `selectWallet` → **зависает**. Legs уходят в `submitting` и через timeout/reaper переводятся в `failed`.

**Доказательство из логов:**
```
KeyVaultService: Key Vault Service initialized (persistence: in-memory fallback)
WalletManagerService: Wallet Manager Service initialized with strategy: round-robin
WalletManagerService: Loaded 0 active wallet states
```

KeyVault работает в режиме **in-memory fallback** — БД-адаптер не подключён. `metaCache` пустой. `getWalletKeysByChain(42161)` возвращает `[]`.

---

## Корневая причина (на основе кода)

### Регистрация DI

**Файл:** `apps/execution-orchestrator/src/execution/execution.module.ts`

```typescript
providers: [
    WalletManagerService,
    // ...
    TypeOrmWalletKeyStore,
    {
      provide: WALLET_KEY_STORE,
      useExisting: TypeOrmWalletKeyStore,
    },
```

Регистрация выглядит правильно. `WALLET_KEY_STORE` привязан к `TypeOrmWalletKeyStore` через `useExisting`.

### KeyVaultService constructor

**Файл:** `packages/nest-platform/src/vault/key-vault.service.ts`

```typescript
constructor(
    @Optional() @Inject(WALLET_KEY_STORE) private readonly store?: WalletKeyStore,
)
```

`@Optional()` означает: если DI не находит `WALLET_KEY_STORE`, `store = undefined`. В этом случае лог:
```typescript
this.logger.log('Key Vault Service initialized (persistence: in-memory fallback)');
```

Именно это мы видим в логах → **store = undefined**.

### DI token

**Файл:** `packages/nest-platform/src/vault/wallet-key-store.ts`

```typescript
export const WALLET_KEY_STORE = Symbol('ARBIBOT_WALLET_KEY_STORE');
```

Это Symbol-токен. NestJS DI с `useExisting` и Symbol-токенами работает корректно, **но** только если модуль, где зарегистрирован провайдер, правильно импортирован.

### KeyVaultModule

**Файл:** `packages/nest-platform/src/vault/key-vault.module.ts`

```typescript
@Global()
@Module({
  providers: [KeyVaultService],
  exports: [KeyVaultService],
})
export class KeyVaultModule {}
```

**KeyVaultModule не экспортирует и не предоставляет `WALLET_KEY_STORE`.** Он предоставляет только `KeyVaultService`. Это правильно — токен `WALLET_KEY_STORE` должен быть зарегистрирован в **использующем** модуле (`execution.module.ts`), что и делается.

### Версия 1: TypeOrmWalletKeyStore не инстанцируется

`useExisting` требует, что `TypeOrmWalletKeyStore` был инстанциирован. Он зависит от `@InjectRepository(WalletKeyEntity)`:

```typescript
constructor(
    @InjectRepository(WalletKeyEntity)
    private readonly repo: Repository<WalletKeyEntity>,
) {}
```

`WalletKeyEntity` зарегистрирован в `TypeOrmModule.forFeature([...])`. Это должно работать.

### Версия 2: Order of providers / forwardRef

NestJS `useExisting` требует, чтобы класс был определён **до** токена в массиве providers. В коде это соблюдено. Но `KeyVaultService` из `KeyVaultModule` (global) инстанцируется раньше, чем `ExecutionModule` регистрирует провайдеров. Если `KeyVaultService` constructor вызывается до того, как `WALLET_KEY_STORE` доступен в DI контейнере → `store = undefined`.

**Это может быть проблемой инициализации NestJS DI контейнера** — global module `KeyVaultService` инстанцируется на ранней стадии, когда `WALLET_KEY_STORE` из `ExecutionModule` ещё не зарегистрирован.

---

## Что нужно проверить в Cursor

### 1. Добавить логирование в KeyVaultService constructor

**Файл:** `packages/nest-platform/src/vault/key-vault.service.ts`

```typescript
constructor(
    @Optional() @Inject(WALLET_KEY_STORE) private readonly store?: WalletKeyStore,
) {
    // ...
    if (this.store) {
        this.logger.log('Key Vault Service initialized (persistence: TypeOrm)');
    } else {
        this.logger.warn('Key Vault Service initialized (persistence: in-memory fallback) — WALLET_KEY_STORE token NOT FOUND in DI container');
    }
}
```

### 2. Проверить тип токена DI

Возможная причина: Symbol vs String token. NestJS в некоторых версиях не корректно резолвит Symbol tokens при `useExisting` через модули. Попробовать заменить на `string` token:

```typescript
// wallet-key-store.ts
export const WALLET_KEY_STORE = 'ARBIBOT_WALLET_KEY_STORE'; // string instead of Symbol
```

### 3. Альтернатива: useFactory вместо useExisting

```typescript
{
    provide: WALLET_KEY_STORE,
    useFactory: (store: TypeOrmWalletKeyStore) => store,
    inject: [TypeOrmWalletKeyStore],
},
```

### 4. Проверить forFeature registration

`WalletKeyEntity` должен быть в `TypeOrmModule.forFeature([...])`:

```typescript
TypeOrmModule.forFeature([WalletState, OnChainTransaction, BridgeTransferEntity, DexDailyVolumeEntity, WalletKeyEntity]),
```

Это есть. Но проверить, что `WalletKeyEntity` — корректная entity с правильной `@Entity()` таблицей `wallet_keys`.

---

## Дополнительная проблема: даже если store найден — ключ в БД, но не в metaCache

Если store загрузит ключи, `metaCache` будет содержать запись:
```
keyId: 'prod-arb-1'
address: '0xDea3...'
chainId: 42161
isActive: true
```

Тогда `getWalletKeysByChain(42161)` вернёт ключ. Но `selectWallet` вызовет `getEncryptedKey(keyId)`, который должен вернуть зашифрованный приватный ключ. Если `VAULT_MASTER_KEY_SALT` или `PRIVATE_KEY_ENCRYPTION_KEY` в `.env` не совпадают с тем, что использовался при импорте → `decryptPrivateKey` упадёт.

**Проверить:** совпадают ли env переменные шифрования с теми, что использовались при импорте кошелька (`tools/wallet-key-import.mjs`).

---

## DoD

1. В логах EO: `Key Vault Service initialized (persistence: TypeOrm)` (не in-memory)
2. `Loaded 1 wallet key(s) from store`
3. `selectWallet` возвращает кошелёк без зависания
4. `wallet_selected` лог появляется
5. `approval_confirmed` лог появляется
6. On-chain tx появляется в `on_chain_transactions`

---

## Ключевые файлы

| Файл | Что |
|------|-----|
| `packages/nest-platform/src/vault/key-vault.service.ts` | `@Optional() @Inject(WALLET_KEY_STORE)` — store = undefined |
| `packages/nest-platform/src/vault/wallet-key-store.ts` | `WALLET_KEY_STORE = Symbol(...)` — DI token |
| `packages/nest-platform/src/vault/key-vault.module.ts` | `@Global()` — не предоставляет `WALLET_KEY_STORE` |
| `apps/execution-orchestrator/src/execution/execution.module.ts:62-68` | `useExisting: TypeOrmWalletKeyStore` — регистрация |
| `apps/execution-orchestrator/src/execution/wallet-key-store.typeorm.ts` | `@InjectRepository(WalletKeyEntity)` — TypeORM adapter |
| `apps/execution-orchestrator/src/execution/wallet-manager.service.ts:110` | `selectWallet` — использует `keyVaultService.getWalletKeysByChain` |
| `apps/execution-orchestrator/src/execution/adapters/uniswap-v3.adapter.ts:368` | Вызов `selectWallet` — точка зависания |

---

## Сверка ZCode (добавлено при архивации, 2026-08-09)

### Диагноз Hermes «DI order» — НЕВЕРЕН

Гипотеза ТЗ («global `KeyVaultModule` инстанцирует `KeyVaultService` раньше, чем `ExecutionModule` регистрирует `WALLET_KEY_STORE`») **опровергнута** двумя независимыми исследованиями кода. Реальная причина — **видимость токена (token VISIBILITY)**, а не порядок инициализации.

**Механика (по коду NestJS DI):**
- `WALLET_KEY_STORE` биндится в `ExecutionModule` (`execution.module.ts:66-68`) — модуль **НЕ `@Global`**, токен **НЕ в `exports`**.
- `KeyVaultService` объявлен в `KeyVaultModule` (`key-vault.module.ts:4-8`, `@Global`).
- `@Global()` транслирует exports модуля **наружу** всем потребителям, но НЕ затягивает private-провайдеры `ExecutionModule` внутрь scope `KeyVaultService`.
- Результат: `@Optional() @Inject(WALLET_KEY_STORE)` резолвится в `undefined` → in-memory fallback.

### Эксперимент для подтверждения (из ТЗ §1) — избыточен

ТЗ предлагало убрать `@Optional()` для доказательства. Это сработало бы, но диагноз «DI order» всё равно был бы ошибочным: NestJS flatten'ит providers одного модуля в один injector, поэтому порядок `TypeOrmWalletKeyStore` → `{ provide: WALLET_KEY_STORE }` внутри `ExecutionModule` не имеет значения. Проблема в **scope**, не в порядке.

### Что сделано вместо обхода `attachStore()`

Серверный фикс `attachStore()` / `hydrateFromStore()` / `OnModuleInit` в `TypeOrmWalletKeyStore` — **обход**, маскирующий дефект видимости. Он НЕ перенесён в канон. Вместо него создан отдельный `@Global WalletKeyStoreModule` (PLAN12 #1), который делает токен видимым в global scope — корректное архитектурное решение, соответствующее hexagonal-контракту порта (`wallet-key-store.ts:58-62`: «bound by the host app»).

**Альтернативы из ТЗ, отвергнутые:**
- §2 (Symbol → string token): не причина; Symbol резолвится корректно при правильном scope.
- §3 (`useFactory` вместо `useExisting`): не причина; `useExisting` работает при правильном scope. В каноне `useExisting` и оставлен.

### Результат

- `KeyVaultService` теперь получает TypeORM-адаптер через DI (без поздней привязки).
- Regression guard: `wallet-key-store.module.spec.ts` (PLAN12 #1) — constructирует реальный Nest graph `KeyVaultModule + WalletKeyStoreModule`, ассертит что токен резолвится в `TypeOrmWalletKeyStore` и round-trip шифрования работает. На старом коде (биндинг в `ExecutionModule`) этот тест падал бы.

См. коммит PLAN12 #1: `feat(execution): @Global WalletKeyStoreModule — fix WALLET_KEY_STORE visibility`.
