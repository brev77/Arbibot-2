# D4-B-4-KEYS — Ключи: убрать in-memory кэш Wallet + PRIVATE_KEY_ENCRYPTION_KEY в env-template

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-B-0-LIVE-ADR` |
| **risk_level** | `high` |
| **estimated_hours** | 6 |
| **status** | `planned` |

## Контекст (из ревью)
- `packages/nest-platform/src/vault/key-vault.service.ts:49`: `private encryptedKeys = new Map()` — in-memory store, комментарий «в проде будет в БД». AES-256-GCM криптография корректна, но storage software-only.
- `apps/execution-orchestrator/src/execution/wallet-manager.service.ts`: `walletCache` кэширует `new Wallet(privateKey, provider)` **на всё время жизни процесса** — расшифрованный plaintext живёт в памяти (нарушение K1.2) (L4).
- `PRIVATE_KEY_ENCRYPTION_KEY` отсутствует в `.env.production.example`.
- Vault не интегрирован (только `docs/vault-integration-guide.md`).

## Outputs
1. **`wallet-manager.service.ts`** — убрать долгоживущий `walletCache`:
   - `selectWallet`/`selectByBalance` создают `Wallet` per-call, используют, обнуляют reference после операции
   - Или short-TTL cache (~30s) с eviction после signing
   - Никогда не держать plaintext дольше одной транзакции
2. **`key-vault.service.ts`** — персист encrypted keys в БД вместо `Map`:
   - Новая таблица (миграция `040_wallet_keys.sql`): `(key_id, chain_id, encrypted_payload, …)` — encrypted blob (уже AES-encrypted, дополнительный слой не нужен)
   - `KeyVaultService` читает из БД по `key_id`, расшифровывает on-demand
3. **`.env.production.example`** — добавить `PRIVATE_KEY_ENCRYPTION_KEY=<CHANGE_ME_USE_VAULT>` + комментарий про ключ-вращение
4. **(ADR/опц.)** Vault/KMS integration — если live требует, описать roadmap в `docs/vault-integration-guide.md` (реализация может быть отдельным шагом D4-B-4b)

## Acceptance
- [ ] `WalletManagerService` не кэширует `Wallet` дольше одной операции (heap snapshot: нет висящих privateKey после GC)
- [ ] `KeyVaultService` персистит в БД (переживает рестарт)
- [ ] `PRIVATE_KEY_ENCRYPTION_KEY` в `.env.production.example`
- [ ] K2 leakage guard (`tools/ci-key-leakage.sh`) всё ещё проходит
- [ ] Юнит-тесты: расшифровка on-demand, корректность после рестарта

## Edge Cases
- Perf-удар от перерасшифровки per-call → short-TTL cache как компромисс (не долгоживущий)
- Селекция по балансу (`selectByBalance`) расшифровывала каждый ключ — теперь расшифровывать только выбранный, проверять баланс через read-only call (без расшифровки, если возможно через provider)
- Backup таблицы wallet_keys → она encrypted-at-rest, но при бэкапе убирать из стандартного dump (pg_dump --exclude) и хранить отдельно

## Test Commands
```bash
npm run test -w @arbibot/execution-orchestrator
npm run test -w @arbibot/nest-platform
npm run build
npm run ci:key-leakage   # не должно регрессить
```

## Rollback
`git checkout -- packages/nest-platform/src/vault/ apps/execution-orchestrator/src/execution/wallet-manager.service.ts .env.production.example` + drop table (forward-only)
