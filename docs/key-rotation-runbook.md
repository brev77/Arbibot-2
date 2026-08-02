# Key Rotation Runbook

## Область применения

Ротация ключей для DEX execution wallet'ов в `execution-orchestrator`.

## Когда проводить

- **Плановая ротация:** каждые 90 дней (или по policy)
- **Экстренная ротация:** при компрометации ключа, подозрительных транзакциях, инцидентах security

## Предварительные проверки

1. Убедиться, что нет активных ExecutionPlan в состоянии `executing` на затронутом chainId
2. Проверить `GET /health/rpc` — RPC провайдер должен быть `healthy`
3. Проверить баланс нового wallet'а (должен быть достаточным для gas)

## Процедура плановой ротации

### Шаг 1: Генерация нового ключа

```bash
# Генерация через openssl
openssl rand -hex 32
```

### Шаг 2: Шифрование и сохранение в KeyVault

**P8-3 (2026-08-02):** используйте CLI `npm run wallet:import` (`tools/wallet-key-import.mjs`)
— это единственный поддерживаемый путь. CLI валидирует derived address, шифрует
AES-256-GCM (тем же algorithm что `KeyVaultService`), INSERT в `wallet_keys`,
никогда не логирует ключ. Прямой SQL `INSERT` и программный вызов
`KeyVaultService.encryptPrivateKey()` вне CLI не рекомендуются (нет валидации
address, нет audit).

```bash
# На хосте (SSH), из корня репо:
cd /root/Arbibot-2
set -a && . ./.env && set +a   # DATABASE_URL, PRIVATE_KEY_ENCRYPTION_KEY, VAULT_MASTER_KEY_SALT

# Ротация = НОВЫЙ key_id (не перезаписывать старый):
echo "0xNEW_PRIVATE_KEY" | npm run wallet:import -- \
    --key-id prod-arb-2 \
    --chain-id 42161 \
    --expected-address 0xNEW_ADDRESS
```

См. [`docs/adr-wallet-key-import.md`](adr-wallet-key-import.md) для threat model
(K1/K2) и [`docs/vault-integration-guide.md`](vault-integration-guide.md) §6.

<details>
<summary>Программный путь (устаревший, для reference)</summary>

```typescript
const encrypted = await keyVaultService.encryptPrivateKey(
  newPrivateKey,
  keyId,       // уникальный ID нового ключа
);
await keyVaultService.registerWalletKey(keyId, address, chainId);
```

Этот путь не валидирует derived address автоматически — используйте CLI вместо него.

</details>

### Шаг 3: Активация нового ключа

1. Установить статус нового ключа `active`
2. Установить статус старого ключа `rotating`
3. Вызвать `WalletManagerService.clearWalletCache()` для сброса кэша

### Шаг 4: Перевод активов (если нужно)

Перевести ETH/tokens со старого wallet'а на новый через отдельную транзакцию.

### Шаг 5: Деактивация старого ключа

После подтверждения:
- Все активные позиции переведены
- Нет pending транзакций
- Gas balance = 0

Установить статус старого ключа `deprecated`.

## Экстренная ротация

1. Немедленно установить статус скомпрометированного ключа `revoked`
2. Вызвать `clearWalletCache()`
3. Активировать новый ключ (Шаг 2–3)
4. Создать incident в HERMES (`POST /HERMES/v1/incidents`)
5. Записать audit entry

## Откат

Если ротация прошла с ошибками:
1. Вернуть старый ключ в статус `active`
2. Установить новый ключ в статус `rotating`
3. Вызвать `clearWalletCache()`
4. Проверить `GET /health/rpc` и баланс

## Мониторинг

После ротации проверить:
- `GET /health/rpc` — статус RPC
- `arb_wallet_selection_total{chain_id="<chain>"}` — wallet используется
- `arb_wallet_insufficient_funds_total` — нет ошибок баланса
- `arb_rpc_failures_total` — нет RPC ошибок

## Переменные окружения

| Переменная | Описание |
|-----------|----------|
| `WALLET_SELECTION_STRATEGY` | Стратегия выбора wallet (`round-robin`, `weighted`, `balance-based`) |

## Audit

Все действия ротации логируются через `AuditClientService.appendEntry()` с:
- `action: 'key_rotation'`
- `operatorId` — ID оператора
- `details` — { chainId, oldKeyId, newKeyId, reason }