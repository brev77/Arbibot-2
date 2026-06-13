# Arbibot 2 — HashiCorp Vault Integration Guide

**Статус:** Phase C Reference — Draft v1
**Дата:** 2026-06-13
**Scope:** Интеграция HashiCorp Vault для централизованного управления секретами Arbibot 2.

---

## 1. Цель

Заменить хранение секретов в `.env` / `docker-compose.prod.yml` на централизованный Vault для:
- **Аудита** доступа к секретам (кто, когда, какой секрет).
- **Ротации** ключей без реdeploy сервисов (dynamic secrets).
- **Шифрования** transit-секретов (envelope encryption для wallet keys).
- **Leasing** с авто-отзывом при падении сервиса.

> ⚠️ Документ описывает **целевую архитектуру** Phase C. Текущий paper-deploy использует `.env` + `<CHANGE_ME_USE_VAULT>` маркеры — это допустимо для paper, **обязательно** для live.

---

## 2. Архитектура интеграции

```
┌──────────────────────────────────────────────────────────────────┐
│ HashiCorp Vault (отдельный host / managed HCP Vault)              │
│   - KV Secrets Engine v2 (static secrets)                         │
│   - Database Secrets Engine (dynamic DB creds)                    │
│   - Transit Secrets Engine (envelope encryption для wallet keys)  │
│   - PKI Secrets Engine (internal mTLS CA)                         │
└────────────┬─────────────────────────────────────────────────────┘
             │ AppRole auth (role-id + secret-id per service)
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ Arbibot Microservices (12 NestJS + Next.js)                       │
│   - Vault Agent sidecar (renew tokens, render secrets to file)    │
│   - OR @arbibot/nest-platform VaultClient (direct API)            │
└────────────┬─────────────────────────────────────────────────────┘
             │ Read at runtime
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ PostgreSQL · Redis · Redpanda · S3                                │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Secrets Engine — конфигурация

### 3.1 KV Secrets v2 (static)

```bash
# Включить KV v2 по пути arbibot/
vault secrets enable -path=arbibot -version=2 kv

# Структура путей:
# arbibot/database/postgres-creds          { username, password }
# arbibot/database/redis-creds             { password }
# arbibot/api-hermes/gateway-keys          { keys: "key1,key2" }
# arbibot/api-bridges/across               { api_key }
# arbibot/api-bridges/stargate             { api_key }
# arbibot/dex/wallet-master-key            { key (envelope-encrypted) }
# arbibot/web/operator-session-secret      { secret }
# arbibot/observability/grafana-admin      { password }
# arbibot/nginx/tls-key                    { key }
```

Пример записи:
```bash
vault kv put arbibot/database/postgres-creds \
  username="arbibot_app" \
  password="$(openssl rand -base64 32)"
```

### 3.2 Database Secrets Engine (dynamic creds)

**Цель:** короткоживущие DB-аккаунты вместо статического `DATABASE_URL`.

```bash
vault secrets enable database

# Конфигурация PostgreSQL connection
vault write database/config/arbibot-postgres \
  plugin_name=postgresql-database-plugin \
  allowed_roles="arbibot-*" \
  connection_url="postgresql://{{username}}:{{password}}@postgres:5432/arbibot?sslmode=disable" \
  username="arbibot_vault_admin" \
  password="<VAULT_ADMIN_PASSWORD>"

# Роль с TTL 1h, max TTL 24h, CREATE/SELECT/INSERT/UPDATE/DELETE
vault write database/roles/arbibot-app \
  db_name=arbibot-postgres \
  creation_statements=@infra/vault/sql/arbibot-app-create.sql \
  revocation_statements=@infra/vault/sql/arbibot-app-revoke.sql \
  default_ttl="1h" \
  max_ttl="24h"
```

Сервис запрашивает:
```bash
vault read database/creds/arbibot-app
# → { username: "v-arbibot-app-abc123", password: "...", ttl: "1h" }
```

### 3.3 Transit Secrets Engine (envelope encryption)

**Цель:** wallet keys шифруются через Vault transit, master-key никогда не покидает Vault.

```bash
vault secrets enable transit

# Создать encryption key
vault write -f transit/keys/arbibot-wallet-key type=aes256-gcm96

# Encrypt (вызывает KeyVaultService перед записью в DB)
vault write transit/encrypt/arbibot-wallet-key plaintext="$(base64 <<< $PLAINTEXT)"
# → { ciphertext: "vault:v1:..." }

# Decrypt (вызывает KeyVaultService перед использованием)
vault write transit/decrypt/arbibot-wallet-key ciphertext="vault:v1:..."
# → { plaintext: "..." }
```

**Изменение в `KeyVaultService`:**
```typescript
// Было (paper):
const cipher = createCipheriv('aes-256-gcm', this.masterKey, iv);
// Станет (live):
const result = await this.vaultClient.write('transit/encrypt/arbibot-wallet-key', {
  plaintext: Buffer.from(data).toString('base64'),
});
```

### 3.4 PKI Secrets Engine (internal mTLS CA)

**Цель:** вместо самоподписанной CA из `tools/generate-internal-certs.sh` — Vault-managed PKI.

```bash
vault secrets enable -path=pki pki
vault secrets tune -max-lease-ttl=87600h pki

# Root CA
vault write -field=certificate pki/root/generate/internal \
  common_name="Arbibot2 Internal CA" \
  ttl=87600h > CA_cert.crt

# Intermediate CA
vault write pki/roles/allow-arbibot-services \
  allowed_domains="arbibot-backend,internal,svc.cluster.local" \
  allow_subdomains=true \
  max_ttl="72h"

# Issue cert (per service)
vault write -format=json pki/issue/allow-arbibot-services \
  common_name="risk-service.arbibot-backend"
```

---

## 4. Аутентификация сервисов (AppRole)

Каждый сервис получает уникальные `role_id` + `secret_id`:

```bash
# Включить AppRole
vault auth enable approle

# Создать policy для risk-service
vault policy write risk-service - <<EOF
path "arbibot/database/postgres-creds"      { capabilities = ["read"] }
path "database/creds/arbibot-app"            { capabilities = ["read"] }
path "transit/encrypt/arbibot-wallet-key"    { capabilities = ["update"] }
path "transit/decrypt/arbibot-wallet-key"    { capabilities = ["update"] }
path "pki/issue/allow-arbibot-services"      { capabilities = ["update"] }
EOF

# Создать AppRole
vault write auth/approle/role/risk-service \
  token_policies="risk-service" \
  token_ttl="1h" \
  token_max_ttl="4h" \
  secret_id_ttl="0" \
  secret_id_num_uses=0

# Получить role_id + secret_id (для bootstrap, затем revoke secret_id)
vault read auth/approle/role/risk-service/role-id
vault write -f auth/approle/role/risk-service/secret-id
```

`role_id` и `secret_id` передаются сервису через:
- **Docker secrets** (для docker compose)
- **Kubernetes service account** (для k8s — Vault Kubernetes auth method)
- **AWS IAM role** / **GCP service account** (для cloud — Vault JWT/OIDC auth)

---

## 5. Варианты интеграции в Arbibot сервисах

### Вариант A: Vault Agent Sidecar (рекомендуется)

```yaml
# docker-compose.prod.yml (фрагмент)
services:
  risk-service:
    image: ghcr.io/brev77/arbibot-2/risk-service:latest
    volumes:
      - shared-secrets:/vault/secrets:ro
    depends_on:
      - vault-agent-risk

  vault-agent-risk:
    image: hashicorp/vault:1.15
    restart: always
    environment:
      VAULT_ADDR: "https://vault:8200"
      VAULT_APPROLE_ROLE_ID: "@file:/run/secrets/risk-role-id"
      VAULT_APPROLE_SECRET_ID: "@file:/run/secrets/risk-secret-id"
    configs:
      - source: vault-agent-risk
        target: /etc/vault/vault-agent.hcl
    volumes:
      - shared-secrets:/vault/secrets

configs:
  vault-agent-risk:
    content: |
      pid_file = "/pidfile"
      auto_auth {
        method "approle" {
          config = { role_id_file_path = "/run/secrets/risk-role-id" }
        }
        sink "file" { config = { path = "/vault/token" } }
      }
      template {
        source = "/etc/vault/templates/postgres.tpl"
        destination = "/vault/secrets/postgres.env"
      }
      template {
        source = "/etc/vault/templates/redis.tpl"
        destination = "/vault/secrets/redis.env"
      }

volumes:
  shared-secrets:
```

Шаблон `postgres.tpl`:
```go
{{ with secret "database/creds/arbibot-app" }}
DATABASE_URL="postgresql://{{ .Data.username }}:{{ .Data.password }}@postgres:5432/arbibot?sslmode=disable"
{{ end }}
```

### Вариант B: `VaultClient` в `@arbibot/nest-platform`

Прямой API-клиент для сервисов, не требующих hot-reload:

```typescript
// packages/nest-platform/src/vault/vault-client.service.ts (новый модуль Phase C)
@Injectable()
export class VaultClientService {
  private client?: vault.Client;
  private tokenExpiry = 0;

  constructor(private readonly configService: ConfigService) {}

  async connect(): Promise<void> {
    const roleId = this.configService.getOrThrow<string>('VAULT_APPROLE_ROLE_ID');
    const secretId = this.configService.getOrThrow<string>('VAULT_APPROLE_SECRET_ID');
    const addr = this.configService.getOrThrow<string>('VAULT_ADDR');

    this.client = vault({ endpoint: addr });
    const login = await this.client.appRoleLogin({ role_id: roleId, secret_id: secretId });
    this.tokenExpiry = Date.now() + (login.auth.lease_duration ?? 3600) * 1000;
    this.client.token = login.auth.client_token;
  }

  async read<T>(path: string): Promise<T> {
    await this.ensureToken();
    return (await this.client!.read(path)).data as T;
  }

  async write<T>(path: string, payload: Record<string, unknown>): Promise<T> {
    await this.ensureToken();
    return (await this.client!.write(path, payload)).data as T;
  }

  private async ensureToken(): Promise<void> {
    if (Date.now() > this.tokenExpiry - 60_000) {
      await this.connect();
    }
  }
}
```

---

## 6. Изменения в KeyVaultService

```typescript
// apps/execution-orchestrator/src/key-vault/key-vault.service.ts (Phase C diff)
@Injectable()
export class KeyVaultService {
  constructor(
    private readonly vault: VaultClientService, // NEW (Phase C)
    private readonly configService: ConfigService,
  ) {}

  async encrypt(data: Buffer): Promise<string> {
    // Phase C: используем transit engine
    const ciphertext = await this.vault.write<{ ciphertext: string }>(
      'transit/encrypt/arbibot-wallet-key',
      { plaintext: data.toString('base64') },
    );
    return ciphertext.ciphertext; // "vault:v1:..."
  }

  async decrypt(ciphertext: string): Promise<Buffer> {
    const { plaintext } = await this.vault.write<{ plaintext: string }>(
      'transit/decrypt/arbibot-wallet-key',
      { ciphertext },
    );
    return Buffer.from(plaintext, 'base64');
  }
}
```

> ⚠️ AES-256-GCM реализация в `key-vault.service.ts` остаётся как fallback для dev/test.

---

## 7. Ротация секретов

| Секрет | Метод ротации | Частота | Автоматизация |
|--------|---------------|---------|---------------|
| Database creds (dynamic) | Vault Database Engine auto-rotates | 1h TTL | ✅ Vault |
| Hermes API keys | KV + runbook | 90 days | `docs/key-rotation-runbook.md` |
| Wallet master key | Transit rotate | 1 year | `vault write transit/keys/.../rotate` |
| TLS certs (mTLS) | PKI Engine auto | 72h TTL | ✅ Vault + Vault Agent |
| Operator session secret | KV + restart web | 30 days | Manual runbook |
| Backup encryption key | KV + re-encrypt | 1 year | Manual runbook |

---

## 8. Disaster Recovery Vault

- **Vault snapshots** — `vault operator raft snapshot save /backup/vault-$(date +%F).snap`
- **Snapshot schedule** — daily, retention 30 days, encrypted backup to S3.
- **Auto-unseal** — рекомендован (AWS KMS / GCP KMS / Transit Unseal).
- **Recovery shares** — Shamir 5/3 (3 of 5 custodians).
- **Test restore** — ежеквартально.

См. также `docs/disaster-recovery-plan.md`.

---

## 9. Аудит

Vault audit device включается всегда:

```bash
vault audit enable file file_path=/var/log/vault/audit.log
# Или для production:
vault audit enable syslog tag="vault" facility="AUTH"
```

Лог содержит:
- timestamp, auth.method, auth.display_name
- request.path, request.operation
- response (без plaintext значений)

Интеграция с Loki через Promtail (filter `vault_audit`).

---

## 10. Environment Variables (Phase C)

После миграции на Vault:

| Переменная | Назначение |
|-----------|-----------|
| `VAULT_ADDR` | URL Vault (https://vault:8200) |
| `VAULT_APPROLE_ROLE_ID` | Role ID сервиса |
| `VAULT_APPROLE_SECRET_ID` | Secret ID (для bootstrap, затем revoke) |
| `VAULT_NAMESPACE` | Namespace (для HCP Vault) |
| `VAULT_CACERT` | CA cert для TLS к Vault |
| `VAULT_TLS_SKIP_VERIFY` | `false` в production |

Из `.env` **удаляются**: `DATABASE_URL`, `REDIS_URL`, `HERMES_API_KEYS`, `JWT_SECRET`, и т.д.

---

## 11. Rollout Plan (Phase C)

1. **Week 1:** Установить Vault, настроить KV + AppRole для всех сервисов.
2. **Week 2:** Включить Database Engine (dynamic creds) для `risk-service`, `execution-orchestrator`, `paper-trading-service`.
3. **Week 3:** Мигрировать wallet keys на Transit Engine.
4. **Week 4:** Включить PKI Engine для mTLS, заменить `tools/generate-internal-certs.sh`.
5. **Week 5:** Pen-test, smoke нагрузка, failover-тест.
6. **Week 6:** Live capital gate review.

---

## 12. Acceptance Criteria

- [ ] Vault развёрнут в HA-режиме (3 узла raft).
- [ ] Все секреты мигрированы из `.env` в Vault.
- [ ] Database creds dynamic (TTL 1h).
- [ ] Wallet keys через Transit Engine.
- [ ] mTLS certs через PKI Engine.
- [ ] Audit device включён, логи в Loki.
- [ ] Snapshots ежедневно, test restore выполнен.
- [ ] Runbook `docs/key-rotation-runbook.md` обновлён под Vault.
- [ ] Pen-test пройден.

---

## 13. References

- HashiCorp Vault Docs — https://developer.hashicorp.com/vault/docs
- Vault AppRole — https://developer.hashicorp.com/vault/docs/auth/approle
- Transit Engine — https://developer.hashicorp.com/vault/docs/secrets/transit
- `docs/security-hardening-guide.md` — общий security roadmap
- `docs/key-rotation-runbook.md` — процедуры ротации
- `docs/threat-model.md` — T5, S5 — mitigate через Vault