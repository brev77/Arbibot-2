# Arbibot 2 — Security Hardening Guide

**Версия:** 1.0  
**Обновлено:** 2026-05-21  
**Область:** Phase C — подготовка к live capital

---

## Обзор

Этот документ описывает security roadmap для перехода от paper trading к live capital деплою. Paper trading деплой уже имеет базовую безопасность (TLS, non-root containers, network isolation). Live capital потребует усиления.

---

## Текущий статус безопасности (Paper Trading)

### ✅ Реализовано
| Мера | Статус | Где |
|------|--------|-----|
| TLS termination | ✅ | nginx (`infra/nginx/nginx.conf`) |
| Non-root containers | ✅ | Dockerfile.nest/Dockerfile.web (UID 1001) |
| Network isolation | ✅ | `arbibot-backend` + `arbibot-observability` |
| API key auth (HERMES) | ✅ | `x-HERMES-api-key` header |
| AES-256-GCM key encryption | ✅ | `KeyVaultService` |
| RBAC roles | ✅ | viewer/operator/admin |
| Two-step approval | ✅ | `DestructiveOperatorAction` |
| DEX kill switch | ✅ | `DEX_LIVE_KILL_SWITCH` |
| Rate limiting | ✅ | nginx (300 req/min) |
| Security headers | ✅ | nginx (X-Content-Type-Options, X-Frame-Options, etc.) |
| CORS configuration | ✅ | `CORS_ORIGINS` env var |
| Audit trail | ✅ | audit-service |
| Connection pooling | ✅ | PgBouncer |

### ⚠️ Требуется для Live Capital

---

## Phase C: Security Roadmap

### C-1: mTLS между сервисами
**Приоритет:** P1 (блокер для live)  
**Срок:** До live capital

**Задачи:**
- [ ] Генерация internal CA + service certificates
- [ ] NestJS services: HTTPS server с mTLS
- [ ] Docker compose: volume mounts для certs
- [ ] Service mesh consideration (Linkerd/Consul)

**Артефакты:**
- `tools/generate-internal-certs.sh` — CA + service certs
- `infra/nginx/ssl/internal/` — internal cert storage
- Обновлённые `Dockerfile.nest` — SSL config

### C-2: External Secret Manager
**Приоритет:** P1 (блокер для live)  
**Срок:** До live capital

**Варианты:**
1. **HashiCorp Vault** — KV v2 secret engine
2. **AWS Secrets Manager** — если AWS
3. **Docker Secrets** — для Swarm
4. **SOPS** — encrypted files в Git

**Задачи:**
- [ ] Выбрать secret manager
- [ ] Мигрировать все `CHANGE_ME_USE_VAULT` значения
- [ ] Сервисы читают секреты runtime, не из .env
- [ ] Ротация ключей автоматизирована

**Переменные для миграции:**
```
POSTGRES_PASSWORD
GRAFANA_ADMIN_PASSWORD
RISK_POLICY_JOB_TRIGGER_TOKEN
HERMES_API_KEYS
HERMES_BFF_API_KEY
PRIVATE_KEY_ENCRYPTION_KEY
```

### C-3: Formal Threat Model
**Приоритет:** P1  
**Срок:** До live capital

**Область моделирования:**
- DEX execution flow (наибольший риск)
- Wallet key management
- API authentication bypass
- Data exfiltration через observability
- Supply chain attack (npm dependencies)
- Insider threat (operator actions)

**Формат:** STRIDE или PASTA

### C-4: Key Rotation
**Приоритет:** P2  
**Срок:** 30 дней после live

**Задачи:**
- [ ] DB password rotation (zero-downtime)
- [ ] API key rotation (HERMES, inter-service)
- [ ] TLS certificate renewal (Let's Encrypt auto-renew)
- [ ] Wallet key rotation procedure
- [ ] Encryption key rotation (KeyVaultService)

**Runbook:** `docs/key-rotation-runbook.md` (уже существует)

### C-5: Audit Log External Storage
**Приоритет:** P2  
**Срок:** 30 дней после live

**Задачи:**
- [ ] Audit events → S3/ClickHouse long-term storage
- [ ] Immutable audit log (append-only)
- [ ] Retention policy (90 days hot, 1 year cold)
- [ ] Compliance reporting queries

### C-6: Network Hardening
**Приоритет:** P2  
**Срок:** 30 дней после live

**Задачи:**
- [ ] Firewall rules (только 80/443 извне)
- [ ] Database не доступен извне (только через PgBouncer)
- [ ] Redis password authentication
- [ ] Kafka SASL/SCRAM authentication
- [ ] VPN/bastion host для admin access

### C-7: Dependency Scanning
**Приоритет:** P3  
**Срок:** 60 дней после live

**Задачи:**
- [ ] `npm audit` в CI pipeline
- [ ] Snyk/Dependabot для automated PRs
- [ ] Container image scanning (Trivy/Grype)
- [ ] SBOM generation

### C-8: Penetration Testing
**Приоритет:** P3  
**Срок:** 90 дней после live

**Задачи:**
- [ ] External pen-test (API, web dashboard)
- [ ] Internal pen-test (service-to-service, network)
- [ ] Findings → remediation → re-test

---

## Security Configuration Checklist (Paper Trading)

```bash
# 1. Сгенерировать секреты
openssl rand -hex 32  # для каждого CHANGE_ME поля

# 2. Проверить env
bash tools/validate-env.sh

# 3. Сгенерировать TLS
bash tools/generate-tls-certs.sh

# 4. Проверить security headers
curl -skI https://localhost | grep -i "x-content-type\|x-frame\|strict-transport"
```

---

## Incident Response Integration

При security incident:
1. **P1 Security** → немедленное отключение через kill switch
2. Все DEX operations → `DEX_LIVE_KILL_SWITCH=true`
3. Audit log → сохранить в immutable storage
4. Incident → `docs/incident-response-playbook.md`

---

## Compliance Checklist

| Требование | Статус | Примечание |
|------------|--------|-----------|
| Encryption at rest | ✅ | KeyVaultService AES-256-GCM |
| Encryption in transit | ✅ | TLS 1.2/1.3 via nginx |
| Access control | ✅ | RBAC + API keys |
| Audit trail | ✅ | audit-service |
| Secret management | ⚠️ | .env → Vault (Phase C) |
| Network isolation | ✅ | Docker networks |
| Key rotation | ⚠️ | Manual → Auto (Phase C) |
| Vulnerability scanning | ⚠️ | Not yet (Phase C) |