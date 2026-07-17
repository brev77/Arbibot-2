# Arbibot 2 — Deployment Checklist

> ⚠️ **SUPERSEDED (2026-07-17):** актуальная paper-процедура — [`paper-deploy-dod.md`](paper-deploy-dod.md) (Definition of Done, 2026-07-12).
> Этот чеклист (v1.0, 2026-05-21) предшествует фазе D4 deploy-readiness и не учитывает operator auth (D4-A-1), restore (D4-A-3), panic-stop (D4-C-3), versioning (D4-C-2).
> Документ сохранён для истории; цифры миграций/метрик обновлены инлайн.

**Версия:** 1.0
**Обновлено:** 2026-05-21 *(migration/metric figures refreshed 2026-07-17)*
**Цель:** Пошаговый чеклист для деплоя paper trading

---

## Pre-Deploy Checklist

### 1. Код и сборка
- [ ] `npm run build` — 22/22 пакетов собирается без ошибок
- [ ] `npm run lint` — 29/29 пакетов проходит без ошибок
- [ ] `npm run test` — 778/778 тестов проходит (74 suites)
- [ ] `npm run db:verify-migrations:all` — все миграции 001–043 применены
- [ ] Нет незакоммиченных изменений в production ветке

### 2. Environment
- [ ] `.env` создан из `.env.production.example`
- [ ] `bash tools/validate-env.sh` — PASS без FAIL
- [ ] Все `<CHANGE_ME_USE_VAULT>` заменены на реальные значения
- [ ] `POSTGRES_PASSWORD` — 32+ символов
- [ ] `GRAFANA_ADMIN_PASSWORD` — 32+ символов
- [ ] `HERMES_API_KEYS` — уникальные ключи
- [ ] `DEX_LIVE_ENABLED=false` (paper trading!)
- [ ] `DEX_LIVE_KILL_SWITCH=true` (safety!)
- [ ] `CORS_ORIGINS` — конкретные домены (не `*`)

### 3. Секреты и безопасность
- [ ] Все пароли хранятся в secrets manager (не в plaintext)
- [ ] `PRIVATE_KEY_ENCRYPTION_KEY` не установлен (paper trading не требует)
- [ ] API ключи уникальны для каждого окружения
- [ ] TLS сертификаты готовы (или будет использован Let's Encrypt)

### 4. Infrastructure
- [ ] Docker daemon запущен
- [ ] Достаточно дискового пространства (>20 GB свободно)
- [ ] Достаточно RAM (>16 GB рекомендуется)
- [ ] DNS записи настроены (если используется домен)
- [ ] Firewall настроен (только 80/443 извне)

---

## Deploy Steps

### Step 1: Сборка образов
```bash
npm run docker:build
```
- [ ] Все 15 образов собраны без ошибок
- [ ] Образы имеют правильный tag (`latest` или SHA)

### Step 2: TLS сертификаты
```bash
# Для тестирования (self-signed):
bash tools/generate-tls-certs.sh

# Для production (Let's Encrypt / CA):
# Настроить certbot или загрузить сертификаты в infra/nginx/ssl/
```
- [ ] `infra/nginx/ssl/privkey.pem` существует
- [ ] `infra/nginx/ssl/fullchain.pem` существует

### Step 3: Запуск stack
```bash
docker compose -f infra/docker-compose.prod.yml up -d
```
- [ ] Все контейнеры запущены: `docker compose -f infra/docker-compose.prod.yml ps`
- [ ] Нет контейнеров со статусом `Restarting`

### Step 4: Миграции БД
```bash
# Проверить, что миграции применены (bootstrap-schema-migrations.sql)
docker exec $(docker ps -q -f name=postgres) \
  psql -U arbibot -c "SELECT count(*) FROM schema_migrations;"
```
- [ ] 37 миграций применено (schema_migrations count = 37)

### Step 5: Canonical Registry Seeding
```bash
npm run db:seed-canonical
```
- [ ] `venue_refs`, `canonical_instruments`, `canonical_routes` заполнены

### Step 6: Verification
```bash
npm run verify:deployment
```
- [ ] Все health checks PASS
- [ ] Нет FAIL в верификации

---

## Post-Deploy Checklist

### 1. Observability
- [ ] Grafana доступна: `https://<DOMAIN>/grafana/`
- [ ] Prometheus собирает метрики: `http://<HOST>:9090/targets`
- [ ] Loki получает логи: проверка в Grafana Explore
- [ ] Alertmanager доступен: `http://<HOST>:9093/#/alerts`
- [ ] SLO Overview dashboard загружен и показывает данные
- [ ] Настроены notification channels (Slack/Telegram) в Alertmanager

### 2. Operator Dashboard
- [ ] `/dashboard` — загружается, показывает данные
- [ ] `/paper` — paper trading раздел доступен
- [ ] `/settings` — конфигурации читаются
- [ ] `/HERMES` — HERMES gateway отвечает
- [ ] HTTPS работает (редирект с HTTP)

### 3. Functional Smoke Tests
- [ ] Создание opportunity через API
- [ ] Paper enqueue работает
- [ ] Risk evaluation отвечает
- [ ] Audit log записывается
- [ ] Config CRUD через `/settings`

### 4. Alerting
- [ ] Slack/Telegram webhook настроен в `infra/alertmanager/alertmanager.yml`
- [ ] Тестовый алерт отправлен (Alertmanager → Test)
- [ ] Silence rules для обслуживания созданы (если нужно)

---

## Rollback Procedure

Если деплой неудачен:

```bash
# 1. Остановить все контейнеры
docker compose -f infra/docker-compose.prod.yml down

# 2. Откат БД — миграции forward-only (см. deployment-guide §7, D4-A-3-RESTORE).
# НЕ удаляйте строки из schema_migrations — DDL уже выполнен, это не откатит схему.
# Откат = восстановление БД из бэкапа, сделанного ДО миграции:
npm run db:restore -- /path/to/backup.sql.gz
# После restore: npm run db:verify-migrations:all

# 3. Пересобрать с предыдущим tag
IMAGE_TAG=<previous-sha> docker compose -f infra/docker-compose.prod.yml up -d
```

---

## Emergency Contacts

| Роль | Контакт | Escalation |
|------|---------|------------|
| On-call (P1/P2) | См. Alertmanager config | 15 мин |
| Tech lead | См. runbook | 30 мин |
| Product owner | См. org chart | 1 час |

---

## Quick Reference

| Команда | Назначение |
|---------|-----------|
| `bash tools/validate-env.sh` | Проверка .env |
| `bash tools/generate-tls-certs.sh` | Генерация TLS |
| `npm run docker:build` | Сборка образов |
| `npm run verify:deployment` | Верификация деплоя |
| `npm run db:backup` | Backup PostgreSQL |
| `npm run db:seed-canonical` | Canonical registry |
| `docker compose -f infra/docker-compose.prod.yml logs -f` | Логи всех сервисов |
| `docker compose -f infra/docker-compose.prod.yml ps` | Статус контейнеров |