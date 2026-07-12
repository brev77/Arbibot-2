# Arbibot 2 — Incident Response Playbook

**Версия:** 1.0  
**Дата:** 2026-05-21  
**Применимость:** Paper trading → Live trading

---

## 1. Обзор процесса

### Уровни серьёзности (Severity)

| Level | Название | SLA реакции | Примеры |
|-------|----------|-------------|---------|
| **SEV-1** | Critical | 15 мин | ServiceDown ≥ 2 сервисов, DEX loss, data corruption |
| **SEV-2** | High | 1 час | ServiceDown 1 сервис, PaperDriftSustainedHigh, capital mismatch |
| **SEV-3** | Medium | 4 часа | HighErrorRate, DEXRPCDegraded, IntakeDegraded |
| **SEV-4** | Low | 24 часа | HighMemoryUsage, config drift, performance degradation |

### Роли

| Роль | Ответственность |
|------|----------------|
| **Incident Commander (IC)** | Координация, коммуникация, решения |
| **Operator on-call** | Первичный ответчик, диагностика |
| **Technical Lead** | Архитектурные решения, эскалация |

---

## 2. Инцидент-флоу

```
[Обнаружение] → [Триаж] → [Митигация] → [Решение] → [Post-mortem]
     │               │           │             │              │
  Alert/Manual   SEV assign  Stop bleeding  Root fix     Blameless review
```

### Шаги:

1. **Обнаружение** — Alertmanager → Slack/webhook, или ручное обнаружение
2. **Триаж** — определить SEV, назначить IC
3. **Митигация** — стабилизировать систему, остановить кровотечение
4. **Решение** — исправить корневую причину
5. **Post-mortem** — blameless review в течение 48 часов

---

## 3. Типичные инциденты и runbooks

### 3.1. Service Down (SEV-1/SEV-2)

**Симптомы:** `ServiceDown` alert, health check failing

```bash
# Диагностика
docker compose -f infra/docker-compose.prod.yml ps
docker compose -f infra/docker-compose.prod.yml logs <service> --tail=100

# Проверка health
curl http://localhost:<PORT>/metrics

# Действия:
# 1. Restart service
docker compose -f infra/docker-compose.prod.yml restart <service>

# 2. Если не помогает — проверить DB/Redis connectivity
docker exec -it <pgbouncer> psql "$DATABASE_URL" -c "SELECT 1"
docker exec -it <redis> redis-cli ping

# 3. Проверить resource limits
docker stats --no-stream
```

### 3.2. Paper Drift High (SEV-2)

**Симптомы:** `PaperDriftBpsHigh` > 50 bps, `PaperDriftBpsSustainedHigh` > 30 bps for 15m

```bash
# Диагностика
curl http://localhost:3018/paper/drift/samples?limit=20

# Проверить market data quality
curl http://localhost:3015/metrics | grep intake

# Действия:
# 1. Проверить что market intake не degraded
curl http://localhost:3015/health/degradation

# 2. Если intake degraded → см. intake degradation runbook
# 3. Если data OK → увеличить порог alert временно
# 4. Проверить drift gauge accuracy
```

**Связанные runbooks:** [`docs/intake-degradation-runbook.md`](intake-degradation-runbook.md)

### 3.3. DEX Unhealthy (SEV-1/SEV-2)

**Симптомы:** `DEXUnhealthy`, `DEXRPCDegraded`

```bash
# Диагностика
curl http://localhost:3012/health/dex

# Kill switch (если нужно немедленно остановить DEX)
# Установить DEX_LIVE_KILL_SWITCH=true в .env
docker compose -f infra/docker-compose.prod.yml restart execution-orchestrator

# Действия:
# 1. Проверить RPC endpoints
# 2. Проверить wallet balances
# 3. Проверить gas prices
# 4. См. DEX runbooks по цепи
```

**Связанные runbooks:**
- [`docs/dex-arbitrum-runbook.md`](dex-arbitrum-runbook.md)
- [`docs/dex-runbook-failed-tx.md`](dex-runbook-failed-tx.md)
- [`docs/dex-rollback-strategy.md`](dex-rollback-strategy.md)

### 3.4. Database Issues (SEV-1)

**Симптомы:** connection refused, slow queries, migration failures

```bash
# Диагностика
docker exec -it <postgres-container> psql -U arbibot -d arbibot -c "
  SELECT count(*), state FROM pg_stat_activity GROUP BY state;
"

# Проверить PgBouncer pool
docker exec -it <pgbouncer> psql -p 6432 -U arbibot -c "SHOW POOLS;"

# Действия:
# 1. Если connections exhausted → restart PgBouncer
docker compose -f infra/docker-compose.prod.yml restart pgbouncer

# 2. Если slow queries → identify and kill
docker exec -it <postgres> psql -U arbibot -c "
  SELECT pid, now() - pg_stat_activity.query_start AS duration, query
  FROM pg_stat_activity WHERE state = 'active' ORDER BY duration DESC;
"

# 3. Если disk full → backup + cleanup
bash tools/backup-postgres.sh
```

### 3.5. Capital / Position Mismatch (SEV-1)

**Симптомы:** `ReconciliationMismatchDetected` event

```bash
# Диагностика
curl http://localhost:3017/reconciliation/mismatches?status=open

# Запустить reconciliation cycle
curl -X POST http://localhost:3017/reconciliation/run

# Действия:
# 1. См. reconciliation P0 procedures
# 2. Для paper trading → virtual capital, можно reset
# 3. Для live → requires operator approval + audit
```

**Связанные runbooks:** [`docs/reconciliation-p0-procedures.md`](reconciliation-p0-procedures.md)

---

## 4. Kill Switches

| Компонент | Переменная | Действие |
|-----------|-----------|----------|
| DEX live | `DEX_LIVE_KILL_SWITCH=true` | Блокирует все DEX execution |
| DEX paper | `PAPER_DEX_MAINNET_ENABLED=false` | Блокирует paper DEX на mainnet |
| Intake throttling | `INTAKE_THROTTLING_ENABLED=false` | Отключает throttle (пропускает всё) |
| Paper discovery | `PAPER_DISCOVERY_ENABLED=false` | Останавливает discovery worker |
| Policy writers | `RISK_POLICY_JOBS_ENABLED=false` | Останавливает watchlist/scoring jobs |
| Audit | `AUDIT_CLIENT_ENABLED=false` | Отключает audit (экстренно) |

---

## 5. Эскалация

```
Operator on-call
    ↓ (15 min, no response)
Technical Lead
    ↓ (SEV-1, 30 min)
Product Owner / Stakeholders
```

### Каналы коммуникации

| Priority | Канал |
|----------|-------|
| SEV-1 | Phone + Slack #incidents |
| SEV-2 | Slack #incidents |
| SEV-3 | Slack #monitoring |
| SEV-4 | Ticket / async |

---

## 6. Post-mortem шаблон

```markdown
## Post-mortem: [INCIDENT-TITLE]

**Date:** YYYY-MM-DD
**Severity:** SEV-N
**Duration:** X hours Y minutes
**Impact:** [что пострадало, количественные метрики]

### Timeline (UTC)
- HH:MM — Alert triggered
- HH:MM — IC assigned
- HH:MM — Root cause identified
- HH:MM — Mitigation applied
- HH:MM — Fully resolved

### Root Cause
[Описание корневой причины]

### What went well
- [x] ...

### What could be improved
- [ ] ...

### Action items
- [ ] ACTION-1 — [owner] — [due date]
- [ ] ACTION-2 — [owner] — [due date]
```

---

## 7. Контактная информация

### 7.1 Paging-каналы (автоматические, D4-A-2-PAGING)

Paging настроен в `infra/alertmanager/alertmanager.yml.tpl` (см. `docs/observability-tracing.md` → "Wiring"):
- **PagerDuty** → schedule `arbibot-critical` (severity: critical, infrastructure) — `PAGERDUTY_ROUTING_KEY` env.
- **Slack** → канал `#arbibot-critical` (critical, infrastructure) / `#arbibot-on-call` (warnings, paper, dex) — `SLACK_WEBHOOK_URL` env.
- **Incidents UI** → `/incidents` (все алёрты, audit-trail) — через `arbibot-incidents` receiver → reconciliation-service.

При срабатывании critical-алёрта (например `ServiceDown`) on-call получает PagerDuty page + Slack-уведомление в течение 15s (`group_wait`). SLA ack — 5 мин.

### 7.2 Роли и назначение

Обновить при назначении on-call roster (имена/контакты конкретных операторов — вне репозитория, хранятся в PagerDuty schedule `arbibot-critical` и Slack `#arbibot-on-call`):

| Роль | Назначение | Где найти текущего дежурного |
|------|-----------|------------------------------|
| IC (Incident Commander) | Координация инцидента, решения | PagerDuty `arbibot-critical` → current on-call |
| On-call engineer | Первичный ответчик, диагностика | PagerDuty `arbibot-critical` → current on-call |
| Tech Lead | Эскалация Tier 2 (15–30 мин) | PagerDuty `Arbibot Escalation` policy |
| DBA | БД-специфичные инциденты | Slack `#arbibot-on-call` → ask for DBA |

> Конкретные имена/телефоны/email операторов **намеренно не хранятся в репозитории** — они живут в PagerDuty schedule и ротируются. При первом выкате product-owner должен создать schedule `arbibot-critical` в PagerDuty и занести туда операторов.