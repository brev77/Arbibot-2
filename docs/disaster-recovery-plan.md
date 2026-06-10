# Arbibot 2 — Disaster Recovery Plan

**Версия:** 1.0  
**Дата:** 2026-05-21  
**RTO (Recovery Time Objective):** 4 часа  
**RPO (Recovery Point Objective):** 24 часа (daily backup)

---

## 1. Определение disaster

Disaster — событие, при котором **вся система или критический компонент** недоступен и не может быть восстановлен стандартными средствами (restart, config change).

### Классификация

| Категория | Описание | Примеры |
|-----------|----------|---------|
| **Data Loss** | Потеря данных PostgreSQL | Disk corruption, accidental DROP, hardware failure |
| **Infrastructure** | Недоступность сервера | VM crash, cloud outage, network partition |
| **Security** | Компрометация | Key leak, unauthorized access, ransomware |
| **Application** | Критический баг | Deploy сломал все сервисы, migration corruption |

---

## 2. Резервное копирование

### 2.1. Что бэкапится

| Компонент | Метод | Частота | Retention |
|-----------|-------|---------|-----------|
| PostgreSQL | `pg_dump` (compressed) | Daily 02:00 UTC | 30 дней |
| Redis | AOF + RDB (built-in) | Continuous | Auto |
| Docker volumes | Snapshot (optional) | Weekly | 4 недели |
| Config (.env) | Manual / version control | On change | Git history |

### 2.2. Процедура бэкапа

```bash
# Автоматический (cron)
0 2 * * * /opt/arbibot/tools/backup-postgres.sh >> /var/log/arbibot-backup.log 2>&1

# Ручной
DATABASE_URL="postgres://arbibot:PASS@HOST:5432/arbibot" bash tools/backup-postgres.sh

# S3 offsite (опционально — раскомментировать в backup-postgres.sh)
# S3_BACKUP_BUCKET=s3://my-arbibot-backups bash tools/backup-postgres.sh
```

### 2.3. Проверка бэкапа

```bash
# Раз в месяц — проверять восстановление на тестовом окружении
gunzip -c backups/arbibot_LATEST.sql.gz | psql "$TEST_DATABASE_URL"

# Проверить целостность
pg_restore --list backups/arbibot_LATEST.sql.gz > /dev/null
```

---

## 3. Сценарии восстановления

### 3.1. PostgreSQL data loss / corruption

**RTO:** 2–4 часа  
**RPO:** ≤ 24 часа (время последнего бэкапа)

```bash
# 1. Остановить все сервисы
docker compose -f infra/docker-compose.prod.yml stop

# 2. Оставить только PostgreSQL
docker compose -f infra/docker-compose.prod.yml start postgres

# 3. Восстановить из бэкапа
gunzip -c /backups/arbibot_YYYYMMDD_HHMMSS.sql.gz | \
  psql "postgres://arbibot:${POSTGRES_PASSWORD}@localhost:5432/arbibot"

# 4. Проверить миграции
psql "$DATABASE_URL" -c "SELECT count(*) FROM schema_migrations;"

# 5. Запустить все сервисы
docker compose -f infra/docker-compose.prod.yml up -d

# 6. Верифицировать
bash tools/verify-deployment.sh
```

### 3.2. Full infrastructure loss (новый сервер)

**RTO:** 4–8 часов  
**RPO:** ≤ 24 часа

```bash
# 1. Клонировать репозиторий
git clone git@github.com:brev77/Arbibot-2.git /opt/arbibot
cd /opt/arbibot

# 2. Восстановить .env из секретного хранилища
# (Vault, S3 encrypted, 1Password, etc.)
cp /secure/location/.env .env

# 3. Pull образы из GHCR
docker compose -f infra/docker-compose.prod.yml pull

# 4. Запустить data stores
docker compose -f infra/docker-compose.prod.yml up -d postgres redis redpanda

# 5. Дождаться healthy PostgreSQL
docker compose -f infra/docker-compose.prod.yml ps postgres

# 6. Восстановить данные
gunzip -c /backups/arbibot_LATEST.sql.gz | \
  docker exec -i <postgres-container> psql -U arbibot -d arbibot

# 7. Запустить все сервисы
docker compose -f infra/docker-compose.prod.yml up -d

# 8. Засеять canonical registry
npm run db:seed-canonical

# 9. Верифицировать
bash tools/verify-deployment.sh
```

### 3.3. Compromised secrets

**RTO:** 2 часа

```bash
# 1. Rotate все секреты (параллельно):
#    - POSTGRES_PASSWORD
#    - GRAFANA_ADMIN_PASSWORD
#    - HERMES_API_KEYS
#    - HERMES_BFF_API_KEY
#    - RISK_POLICY_JOB_TRIGGER_TOKEN
#    - PRIVATE_KEY_ENCRYPTION_KEY

# 2. Обновить .env

# 3. Пересоздать PgBouncer userlist
docker compose -f infra/docker-compose.prod.yml restart pgbouncer

# 4. Пересоздать Redis (flush старых данных)
docker exec <redis> redis-cli FLUSHALL

# 5. Restart все сервисы
docker compose -f infra/docker-compose.prod.yml up -d --force-recreate

# 6. Верифицировать
bash tools/verify-deployment.sh
```

### 3.4. Bad deployment (откат)

**RTO:** 30 мин

```bash
# 1. Откатить образы к предыдущей версии
# В .env:
IMAGE_TAG=<previous-sha-tag>

# 2. Restart
docker compose -f infra/docker-compose.prod.yml up -d --force-recreate

# 3. Если нужно откатить миграции:
# WARNING: миграции вниз могут потерять данные!
# Всегда делать backup перед rollback
bash tools/backup-postgres.sh

# Откат конкретной миграции (пример):
# psql "$DATABASE_URL" -f infra/postgres/migrations/rollback/036_rollback.sql

# 4. Верифицировать
bash tools/verify-deployment.sh
```

---

## 4. DNS / Network recovery

Если используется внешний DNS:

```bash
# Обновить DNS record на новый IP
# Cloudflare example:
# curl -X PUT "https://api.cloudflare.com/client/v4/zones/ZONE/dns_records/RECORD_ID" \
#   -H "Authorization: Bearer TOKEN" \
#   -d '{"type":"A","name":"operator.example.com","content":"NEW_IP","ttl":60}'

# Проверить propagation
dig operator.example.com
```

---

## 5. Тестирование DR

### Регулярность

| Тест | Частота | Кто |
|------|---------|-----|
| Backup restore на тестовом окружении | Monthly | On-call |
| Full infrastructure recovery drill | Quarterly | Team |
| Secret rotation drill | Quarterly | Security |

### Чеклист DR drill

- [ ] Восстановление из бэкапа завершено успешно
- [ ] Все миграции на месте
- [ ] Все сервисы healthy
- [ ] Canonical registry засеян
- [ ] Данные доступны через API
- [ ] Время восстановления < RTO
- [ ] Потеря данных < RPO

---

## 6. Контактная информация

| Компонент | Провайдер | Support |
|-----------|-----------|---------|
| GitHub / GHCR | GitHub | — |
| DNS | TBD | TBD |
| Cloud hosting | TBD | TBD |
| S3 backups | TBD | TBD |

---

## 7. Связанные документы

- [`tools/backup-postgres.sh`](../tools/backup-postgres.sh) — backup script
- [`tools/verify-deployment.sh`](../tools/verify-deployment.sh) — verification script
- [`docs/incident-response-playbook.md`](incident-response-playbook.md) — incident response
- [`docs/dex-rollback-strategy.md`](dex-rollback-strategy.md) — DEX-specific rollback
- [`docs/key-rotation-runbook.md`](key-rotation-runbook.md) — key rotation