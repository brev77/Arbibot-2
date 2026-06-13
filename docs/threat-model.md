# Arbibot 2 — Threat Model (STRIDE)

**Статус:** Phase C Reference — Draft v1
**Дата:** 2026-06-13
**Scope:** All Arbibot 2 services for PAPER deployment baseline; LIVE-ONLY extensions noted explicitly.

---

## 1. Цель документа

Формализованная модель угроз по методологии STRIDE для:
- Идентификации активов, границ доверия и векторов атаки.
- Обоснования контрмер (security controls) и их приоритизации.
- Подготовки к pen-test (Phase C) и live capital gate.
- Соответствия принципам `docs/security-hardening-guide.md`.

> ⚠️ Документ **не заменяет** pen-test и security audit, а служит их входом.

---

## 2. Активы и уровень чувствительности

| # | Актив | Чувствительность | Где хранится | Примечание |
|---|-------|------------------|--------------|------------|
| A1 | Live wallet private keys | **Critical** | KeyVaultService (AES-256-GCM) → DB ciphertext | DEX: `WalletManager` |
| A2 | API keys (HERMES gateway, bridge APIs) | **High** | ENV / Vault (Phase C) | `HERMES_API_KEYS`, bridge adapters |
| A3 | DB credentials (PostgreSQL) | **High** | ENV / Vault | `DATABASE_URL` |
| A4 | Operator session cookies / RBAC | **High** | `apps/web` cookies | `arbibot_role`, `arbibot_operator_id` |
| A5 | Audit log integrity | **High** | PostgreSQL `audit_entries` | Tamper-evident (Phase C: external storage) |
| A6 | Config mutations (risk/execution/capital) | **High** | `config-service` + outbox | Mutations require `approveReason` |
| A7 | Paper trading state | **Medium** | PostgreSQL `paper_*` tables | Paper-only, no real capital |
| A8 | Canonical market data | **Medium** | PostgreSQL + Redis cache | Source: market-intake |
| A9 | TLS private keys (nginx) | **High** | `infra/nginx/ssl/` | TLS termination |
| A10 | Internal mTLS keys (Phase C) | **High** | `infra/nginx/ssl/internal/` | Service mesh trust |

---

## 3. Границы доверия (Trust Boundaries)

```
┌─────────────────────────────────────────────────────────────────┐
│ PUBLIC INTERNET (UNTRUSTED)                                     │
│   - Operator browser                                            │
│   - HERMES agent (external LLM)                                 │
│   - Bridge protocol APIs (Across/Stargate/Native)               │
└─────────────────────┬───────────────────────────────────────────┘
                      │ TLS 1.2/1.3 (nginx)
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ DMZ (nginx TLS termination, rate limiting, sec headers)         │
└─────┬───────────────────────────────────────┬───────────────────┘
      │ Operator session / HMAC API key       │ HTTPS
      ▼                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│ ARBIBOT-BACKEND NETWORK (Docker internal)                       │
│   ┌────────────────────────────────────────────────────────┐   │
│   │ Operator web (Next.js)                                 │   │
│   │ HERMES-gateway (auth guard)                            │   │
│   │ 12 NestJS services                                     │   │
│   └────────────────────────────────────────────────────────┘   │
│              │ mTLS (Phase C)                                   │
│              ▼                                                  │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ DATA PLANE                                               │   │
│ │ PostgreSQL · Redis · Redpanda · S3 (snapshots)           │   │
│ └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ OBSERVABILITY NETWORK (internal:true, isolated)                 │
│   Prometheus · Grafana · Loki · Promtail · Alertmanager         │
└─────────────────────────────────────────────────────────────────┘
```

**Trust levels:**
- **T0 — Public:** Operator browser, external LLM, bridge APIs.
- **T1 — DMZ:** nginx (terminated TLS, rate-limited).
- **T2 — Backend:** Arbibot microservices (mutually trusting, soon mTLS).
- **T3 — Data:** DB/Redis/Kafka/S3 (highest privilege, network-isolated).
- **T4 — Observability:** Read-only metrics/logs (internal network only).

---

## 4. STRIDE-анализ

### 4.1 S — Spoofing (Подмена)

| ID | Угроза | Вектор | Контрмера | Статус |
|----|--------|--------|-----------|--------|
| S1 | Подмена оператора через украденный cookie | Cookie hijack via XSS/MITM | `Secure;HttpOnly;SameSite=Strict` cookies, TLS, RBAC check per endpoint | ✅ Implemented |
| S2 | Подмена сервиса в backend network | Rogue container in `arbibot-backend` | Network isolation + Phase C mTLS (`docs/security-hardening-guide.md` §3) | ⚠️ Phase C |
| S3 | Подмена HERMES agent | Stolen `HERMES_API_KEY` | HMAC API key guard + key rotation runbook (`docs/key-rotation-runbook.md`) | ✅ Implemented |
| S4 | Подмена внешнего bridge API | DNS poisoning, fake endpoint | TLS verification + allowlist bridge domains in adapters | ⚠️ Verify in code review |
| S5 | Подмена DB admin | Compromised DB host | DB on isolated network, PgBouncer auth, Vault-managed creds | ⚠️ Phase C (Vault) |
| S6 | Replay of signed operator request | Captured HMAC request | Nonce/timestamp window in `ServiceAuthModule` | ✅ Implemented (F1) |

### 4.2 T — Tampering (Искажение)

| ID | Угроза | Вектор | Контрмера | Статус |
|----|--------|--------|-----------|--------|
| T1 | Искажение ExecutionPlan state | Direct DB write by rogue service | Single-writer principle, optimistic concurrency, audit log | ✅ Implemented |
| T2 | Искажение fill event | Replay/tamper external callback | Idempotency keys + HMAC envelope signatures | ✅ Implemented |
| T3 | Искажение config value | Unauthorized mutation | Sensitive keys require `approveReason`, audit on every change | ✅ Implemented |
| T4 | Искажение audit log | Direct DB tampering | Append-only table, Phase C: external immutable storage | ⚠️ Phase C |
| T5 | Искажение wallet key in storage | DB breach | AES-256-GCM (KeyVaultService), Phase C: HSM/Vault transit | ⚠️ Phase C (Vault) |
| T6 | Искажение migration file | Compromised CI/CD | Migration files in git, signed commits recommended | ⚠️ Verify signing |

### 4.3 R — Repudiation (Отказ от действий)

| ID | Угроза | Вектор | Контрмера | Статус |
|----|--------|--------|-----------|--------|
| R1 | Оператор отрицает destructive action | No audit trail | Every destructive op → `AuditClientService.appendEntry` with `operatorId`, `action`, `reason`, `timestamp` | ✅ Implemented |
| R2 | Сервис отрицает исполнение plan | Missing correlationId | Event envelopes with `correlationId`, `causationId`, `messageId` | ✅ Implemented |
| R3 | HERMES denies executed command | Missing agent audit | Phase C: persist HERMES command log with signed envelope | ⚠️ Phase C |
| R4 | Bridge transfer untraceable | Missing bridge receipt hash | On-chain tx hash persisted in `bridge_transfers` table | ✅ Implemented |

### 4.4 I — Information Disclosure (Утечка)

| ID | Угроза | Вектор | Контрмера | Статус |
|----|--------|--------|-----------|--------|
| I1 | Утечка wallet private key | DB dump, log injection | AES-256-GCM at rest, never logged, redaction in serializers | ✅ Implemented |
| I2 | Утечка API key в логах | Verbose error logging | `pino` redaction patterns, structured logging, secrets never in payload | ✅ Implemented |
| I3 | Утечка через Prometheus metrics | Sensitive label exposure | Metrics naming `arb_*` prefix, no PII/secret labels (verified) | ✅ Implemented |
| I4 | Утечка через error response | Stack trace to client | Fastify error serializer strips internal details in prod | ✅ Implemented |
| I5 | Утечка через CORS | Wildcard origin | CORS allowlist via `CORS_ORIGINS` ENV | ✅ Implemented |
| I6 | Утечка observability data | Public Grafana | `arbibot-observability` network `internal:true`, nginx auth for Grafana | ✅ Implemented |

### 4.5 D — Denial of Service

| ID | Угроза | Вектор | Контрмера | Статус |
|----|--------|--------|-----------|--------|
| D1 | HTTP flood на операторский UI | Botnet | nginx rate limiting + connection limits | ✅ Implemented |
| D2 | Market data flood | Malicious intake | Phase 4 `IntakeThrottleService` returns 429, degraded mode | ✅ Implemented |
| D3 | DB connection exhaustion | Slow queries / leak | PgBouncer transaction pooling (200 conn cap), TypeORM pool tuning | ✅ Implemented |
| D4 | Outbox backlog explosion | Slow Kafka consumer | `OutboxRelayBacklog` alert, relay worker scaling | ✅ Implemented (alert added) |
| D5 | DEX RPC rate limit | Aggressive pool discovery | RPC provider manager + primary-only fallback | ✅ Implemented |
| D6 | Disk exhaustion (logs/snapshots) | Runaway log volume | Loki retention, S3 lifecycle rules, `DiskSpaceLow` alert | ✅ Implemented (alert added) |

### 4.6 E — Elevation of Privilege

| ID | Угроза | Вектор | Контрмера | Статус |
|----|--------|--------|-----------|--------|
| E1 | Viewer → operator via cookie tampering | Client-side role modification | RBAC enforced server-side (`getOperatorSession`), cookie signed | ✅ Implemented |
| E2 | Operator → admin via IDOR | Direct endpoint access | Per-endpoint RBAC, two-step approval for destructive ops | ✅ Implemented |
| E3 | `ARBIBOT_DEV_ROLE` in prod | Misconfigured ENV | F4 fix: hard-noop when `NODE_ENV=production` | ✅ Implemented |
| E4 | Service escalation via shared DB | SQL injection / UDF abuse | Parameterized queries (TypeORM), least-privilege DB roles (Phase C) | ⚠️ Phase C (DB roles) |
| E5 | Hermes → live capital bypass | Misconfigured gateway allowlist | `HERMESAuthGuard` + operator session injection for POST/PATCH, BFF-side enforcement | ✅ Implemented |
| E6 | Container escape | Vulnerable container runtime | Non-root user (UID 1001), distroless base recommended (Phase C) | ⚠️ Phase C |

---

## 5. Приоритизация рисков (Risk Matrix)

| ID | Impact | Likelihood | Risk | Приоритет |
|----|--------|------------|------|-----------|
| T5 | Critical | Low | Medium | Phase C (Vault) |
| A1 breach | Critical | Low | Medium | Phase C (HSM) |
| E4 | High | Medium | **High** | Phase C DB roles |
| S2 | High | Low | Medium | Phase C mTLS |
| D3 | High | Medium | **High** | Pool tuning + PgBouncer |
| T4 | High | Low | Medium | Phase C audit storage |
| I1 | Critical | Low | Medium | AES-256 ✅ + Phase C HSM |
| E5 | High | Low | Medium | ✅ Implemented |

**Risk = Impact × Likelihood** (Critical/High/Medium/Low × High/Medium/Low).

---

## 6. Live-Capital-Specific Threats (LIVE-ONLY)

> Эти угрозы **не блокируют** paper trading deploy, но обязательны перед live capital.

| ID | Угроза | Контрмера |
|----|--------|-----------|
| L1 | Wallet key exfiltration → fund drain | HSM/Vault transit, signed txn, multi-sig, tx limit policy |
| L2 | Reentrancy / oracle manipulation in DEX | Slippage guards, audit of swap calldata, on-chain reentrancy checks |
| L3 | MEV sandwich attack | Private mempool (Flashbots Protect), slippage tolerance, MEV-Blocker |
| L4 | Bridge exploit (Across/Stargate) | Limit max bridge amount, monitor bridge audit reports, kill switch |
| L5 | Live capital depletion via buggy risk rule | Per-trade hard cap, daily loss limit, auto-halt on threshold breach |
| L6 | Oracle stale price | Staleness check + last-known-good fallback + circuit breaker |

See also: `docs/dex-mev-threats.md`, `docs/dex-live-mainnet-runbook.md`.

---

## 7. Контрмеры по слоям (Defense in Depth)

```
Layer 7 — Application:    RBAC, two-step approval, idempotency, input validation
Layer 6 — Presentation:   TLS termination, security headers, CORS, rate limiting
Layer 5 — Service mesh:   mTLS, HMAC service auth (ServiceAuthModule)
Layer 4 — Transport:      Internal Docker network isolation
Layer 3 — Data:           AES-256-GCM at rest, encrypted backups
Layer 2 — Host:           Non-root containers, resource limits, seccomp
Layer 1 — Network:        Firewall, no public DB/Redis exposure
Layer 0 — Physical:       Cloud provider security (AWS/GCP/Azure responsibility)
```

---

## 8. Атакующие поверхности (Attack Surfaces) — Inventory

| Surface | Endpoints | Auth | Verified |
|---------|-----------|------|----------|
| Operator dashboard (Next.js) | `/dashboard`, `/portfolio`, ... | Session cookie + RBAC | ✅ |
| Operator BFF | `/api/operator/*` | Session cookie | ✅ |
| HERMES gateway | `/HERMES/v1/*` | `HERMES_API_KEYS` HMAC | ✅ |
| Service HTTP APIs | `:3000-3019` | Internal only (no ports) | ✅ |
| Prometheus scrape | `/metrics` | Internal network only | ✅ |
| Grafana | `/grafana/` | Basic auth + nginx | ✅ |
| PostgreSQL | `:15432` (dev only) | Password + PgBouncer | ✅ |
| Redis | internal only | Password (Phase C: ACL) | ✅ |

---

## 9. Тестирование и верификация

| Метод | Частота | Ответственный |
|-------|---------|---------------|
| SAST (ESLint security rules) | Every CI | Automated |
| Dependency scan (npm audit / Trivy) | Weekly + CI | Phase C |
| DAST (OWASP ZAP baseline) | Quarterly | Security team |
| Pen-test (external) | Pre-live + annually | External vendor |
| Threat model review | Quarterly | Architecture guard agent |
| Tabletop exercise (incident) | Semi-annual | Ops team |

---

## 10. Отслеживание и инциденты

- Инциденты безопасности → `docs/incident-response-playbook.md` (P1 severity).
- HERMES safe-mode → `docs/hermes-safe-mode-runbook.md`.
- Disaster recovery → `docs/disaster-recovery-plan.md`.

---

## 11. Limitations / Out of Scope

- **Not modeled:** Cloud IAM misconfigurations (cloud provider responsibility).
- **Not modeled:** Insider threat from cloud admin (addressed by org policy).
- **Not modeled:** Hardware attacks (HSM breach) — mitigated by vendor certifications.
- **Out of scope:** Mobile clients (none exist for Arbibot 2).

---

## 12. References

- `docs/security-hardening-guide.md` — Phase C security roadmap
- `docs/security-baseline.md` — Baseline requirements
- `docs/key-rotation-runbook.md` — Key rotation procedures
- `docs/incident-response-playbook.md` — Incident handling
- `docs/dex-mev-threats.md` — MEV-specific threats
- `docs/dex-live-mainnet-runbook.md` — Live DEX operational procedures
- OWASP Top 10 — https://owasp.org/Top10/
- STRIDE — Microsoft Threat Modeling methodology