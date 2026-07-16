# Arbibot 2 — Руководство по деплою (Paper Trading)

**Версия:** 1.0  
**Дата:** 2026-05-21  
**Цель:** Пошаговая инструкция для первого деплоя Arbibot 2 в режиме paper trading

---

## Содержание

1. [Требования к серверу](#1-требования-к-серверу)
2. [Подготовка окружения](#2-подготовка-окружения)
3. [Конфигурация .env](#3-конфигурация-env)
4. [Сборка Docker-образов](#4-сборка-docker-образов)
5. [TLS-сертификаты](#5-tls-сертификаты)
6. [Запуск стека](#6-запуск-стека)
7. [Инициализация данных](#7-инициализация-данных)
8. [Верификация деплоя](#8-верификация-деплоя)
9. [Настройка Observability](#9-настройка-observability)
10. [Функциональное тестирование](#10-функциональное-тестирование)
11. [Обновление и откат](#11-обновление-и-откат)
12. [Решение проблем](#12-решение-проблем)

---

## 1. Требования к серверу

### Минимальные требования (Paper Trading)

| Ресурс | Минимум | Рекомендация |
|--------|---------|--------------|
| CPU | 4 ядра | 8 ядер |
| RAM | 8 GB | 16 GB |
| Диск | 40 GB SSD | 80 GB SSD |
| ОС | Ubuntu 22.04+ / Debian 12+ | Ubuntu 24.04 LTS |
| Docker | 24.0+ | 27.x |
| Docker Compose | v2.20+ | v2.32+ |

### Количество контейнеров: 22

| Категория | Контейнеры | Кол-во |
|-----------|-----------|--------|
| Data stores | postgres, redis, redpanda | 3 |
| Connection pooler | pgbouncer | 1 |
| Backend services | risk, opportunity, capital, execution, audit, canonical, intake, portfolio, reconciliation, paper, config, HERMES | 12 |
| Frontend | web (Next.js) | 1 |
| Observability | prometheus, grafana, loki, promtail, alertmanager | 5 |

### Суммарное потребление ресурсов

| Ресурс | Минимум | Пик |
|--------|---------|-----|
| RAM | ~6 GB | ~12 GB |
| CPU | ~2 ядра | ~6 ядер |
| Диск I/O | Низкий | Умеренный |

### Подготовка сервера

```bash
# 1. Обновить систему
sudo apt update && sudo apt upgrade -y

# 2. Установить Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Перелогиниться!

# 3. Проверить Docker
docker --version       # >= 24.0
docker compose version # >= v2.20

# 4. Установить утилиты
sudo apt install -y git curl jq

# 5. Открыть порты в firewall
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

---

## 2. Подготовка окружения

### Клонирование репозитория

```bash
git clone git@github.com:brev77/Arbibot-2.git
cd Arbibot-2
```

### Проверка целостности кода

```bash
# Установить зависимости
npm ci

# Верифицировать сборку (21/21 ✅)
npm run build

# Верифицировать линтер (28/28 ✅)
npm run lint

# Верифицировать тесты (392/392 ✅)
npm run test
```

> **Важно:** Все три команды должны пройти без ошибок перед деплоем.

---

## 3. Конфигурация .env

### Шаг 1: Создать .env из шаблона

```bash
cp .env.production.example .env
```

### Шаг 2: Заполнить обязательные секреты

Отредактируйте `.env`, заменив все `<CHANGE_ME_USE_VAULT>`:

```bash
# Генерация надёжных паролей (Linux/Mac):
openssl rand -hex 32

# Или через Node.js:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Обязательные для замены:**

| Переменная | Мин. длина | Пример генерации |
|------------|-----------|-----------------|
| `POSTGRES_PASSWORD` | 32+ chars | `openssl rand -hex 32` |
| `GRAFANA_ADMIN_PASSWORD` | 32+ chars | `openssl rand -hex 32` |
| `RISK_POLICY_JOB_TRIGGER_TOKEN` | 32+ chars | `openssl rand -hex 32` |
| `HERMES_API_KEYS` | 32+ chars | `openssl rand -hex 32` |
| `HERMES_BFF_API_KEY` | 32+ chars | `openssl rand -hex 32` |

### Шаг 3: Настроить CORS

```bash
# Указать реальный домен операторского дашборда:
CORS_ORIGINS=https://arbibot.yourdomain.com
```

### Шаг 4: Настроить DATABASE_URL

```bash
# Через PgBouncer (рекомендуется для production):
DATABASE_URL=postgres://arbibot:YOUR_PASSWORD@pgbouncer:6432/arbibot

# Напрямую (для отладки):
# DATABASE_URL=postgres://arbibot:YOUR_PASSWORD@postgres:5432/arbibot
```

### Шаг 5: Проверить флаги Paper Trading

Убедитесь, что DEX **отключен**:

```bash
DEX_LIVE_ENABLED=false       # DEX live отключен
DEX_LIVE_KILL_SWITCH=true    # Kill switch активен
DEX_LIVE_DRY_RUN=true        # Dry-run режим
```

### Шаг 6: Валидация .env

```bash
npm run verify:env
```

**Ожидаемый результат:**
```
╔══════════════════════════════════════════════════╗
║  Arbibot 2 — Environment Validator              ║
╚══════════════════════════════════════════════════╝
  ✓ POSTGRES_PASSWORD — set (64 chars)
  ✓ GRAFANA_ADMIN_PASSWORD — set (64 chars)
  ...
  ✓ DEX_LIVE_ENABLED=false — correct for paper trading
  ✓ DEX_LIVE_KILL_SWITCH=true — safety enabled

Environment is ready for deployment
```

> **Если есть FAIL — деплой невозможен. Сначала исправьте все критические ошибки.**

---

## 4. Сборка Docker-образов

### Вариант A: Локальная сборка на сервере

```bash
# Сборка всех 15 образов (12 NestJS + 1 web + 2 external):
npm run docker:build
```

**Ожидаемый результат:**
```
=== Build summary ===
Total services: 13
All images built successfully.
```

> Время сборки: ~10-20 минут в зависимости от CPU и кэша.

### Вариант B: Сборка в CI и pull из registry

```bash
# Авторизоваться в GitHub Container Registry:
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u brev77 --password-stdin

# Pull образов:
docker compose -f infra/docker-compose.prod.yml pull
```

### Вариант C: Сборка с push в registry

```bash
# Собрать и запушить:
npm run docker:push

# Или с указанием tag:
bash tools/docker-build-all.sh --push --tag v1.0.0
```

### Проверка собранных образов

```bash
docker images | grep arbibot
```

Должно быть 13 образов:
- `arbibot-risk-service`
- `arbibot-opportunity-service`
- `arbibot-capital-service`
- `arbibot-execution-orchestrator`
- `arbibot-audit-service`
- `arbibot-canonical-market-service`
- `arbibot-market-intake-service`
- `arbibot-portfolio-service`
- `arbibot-reconciliation-service`
- `arbibot-paper-trading-service`
- `arbibot-config-service`
- `arbibot-HERMES-gateway`
- `arbibot-web`

---

## 5. TLS-сертификаты

### Вариант A: Self-signed (для тестирования)

```bash
npm run generate:tls
```

Создаёт файлы в `infra/nginx/ssl/`:
- `privkey.pem`
- `fullchain.pem`

> ⚠️ Self-signed сертификаты вызовут предупреждение в браузере. Для production используйте Let's Encrypt.

### Вариант B: Let's Encrypt (production)

```bash
# 1. Установить certbot
sudo apt install -y certbot

# 2. Получить сертификат (замените домен и email)
sudo certbot certonly --standalone \
  -d arbibot.yourdomain.com \
  -m admin@yourdomain.com \
  --agree-tos

# 3. Скопировать сертификаты
sudo cp /etc/letsencrypt/live/arbibot.yourdomain.com/privkey.pem \
  infra/nginx/ssl/privkey.pem
sudo cp /etc/letsencrypt/live/arbibot.yourdomain.com/fullchain.pem \
  infra/nginx/ssl/fullchain.pem

# 4. Настроить auto-renewal
echo "0 0 1 * * certbot renew --quiet && cp /etc/letsencrypt/live/arbibot.yourdomain.com/*.pem $(pwd)/infra/nginx/ssl/ && docker compose -f infra/docker-compose.prod.yml restart nginx" | crontab -
```

### Проверка

```bash
ls -la infra/nginx/ssl/
# Должно быть:
# fullchain.pem
# privkey.pem
```

### Вариант для paper-deploy (D4-A-6-TLS)

Для **paper на изолированном хосте** есть два приемлемых пути:

**Путь 1 — Self-signed + импорт CA в браузер оператора** (paper-only):
```bash
# Сгенерировать self-signed (SAN включает localhost + IP):
DOMAIN=<host-ip-or-localhost> npm run generate:tls
# Импортировать infra/nginx/ssl/fullchain.pem в браузер оператора как
# доверенный CA (Chrome: Settings → Security → Manage certificates → Authorities).
# Это убирает browser-warning без публичного CA.
```

**Путь 2 — Let's Encrypt** (если у хоста есть публичный домен):
используйте «Вариант B» выше.

### HSTS (Strict-Transport-Security) — gating

`infra/nginx/nginx.conf` содержит HSTS-заголовок (раскомментирован в D4-A-6-TLS):

```nginx
add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
```

> ⚠️ **HSTS пинит браузер к HTTPS на 2 года.** Включайте HSTS **только** после
> подтверждения, что HTTPS стабилен с **валидным (CA-signed)** сертификатом.
>
> **Для paper-deploy с self-signed сертификатом — ЗАКОММЕНТИРУЙТЕ строку HSTS**
> в `infra/nginx/nginx.conf`. Иначе браузер оператора запомнит self-signed cert
> на `max-age` (63072000s ≈ 2 года), и доступ к UI будет заблокирован даже после
> установки валидного сертификата. HSTS включается при переходе на Let's Encrypt
> (Путь 2) или CA-сертификат организации.

Проверить, что HSTS не отдаётся (paper/self-signed):
```bash
curl -skI https://localhost/ | grep -i strict-transport
# Ожидание для self-signed/paper: (пусто — HSTS закомментирован)
```

---

## 6. Запуск стека

### Шаг 1: Запуск инфраструктуры (data stores)

```bash
# Запустить только базовые сервисы и подождать их готовности:
docker compose -f infra/docker-compose.prod.yml up -d postgres redis redpanda pgbouncer

# Дождаться healthy-статуса:
docker compose -f infra/docker-compose.prod.yml ps
```

**Ждать, пока все 4 контейнера не станут `healthy` (~30-60 секунд).**

### Шаг 2: Запуск backend-сервисов

```bash
# Core services (без зависимостей):
docker compose -f infra/docker-compose.prod.yml up -d \
  risk-service \
  config-service \
  audit-service \
  canonical-market-service \
  portfolio-service

# Подождать health checks (30 сек):
sleep 30

# Services с зависимостями:
docker compose -f infra/docker-compose.prod.yml up -d \
  capital-service \
  opportunity-service \
  market-intake-service \
  paper-trading-service \
  reconciliation-service \
  execution-orchestrator \
  HERMES-gateway

# Подождать health checks (30 сек):
sleep 30
```

### Шаг 3: Запуск frontend + observability

```bash
# Web dashboard + observability stack:
docker compose -f infra/docker-compose.prod.yml up -d \
  web \
  prometheus \
  grafana \
  loki \
  promtail \
  alertmanager \
  nginx
```

### Шаг 4: Проверить все контейнеры

```bash
docker compose -f infra/docker-compose.prod.yml ps
```

**Ожидаемый результат:** все 22 контейнера со статусом `Up` или `Up (healthy)`.

```bash
# Быстрая проверка:
docker compose -f infra/docker-compose.prod.yml ps --format json | jq -r '.[].State' | sort | uniq -c
#    22 running
```

---

## 7. Инициализация данных

### Шаг 1: Применить миграции БД

> **Процедура prod-применения миграций (D4-A-4-MIGRATIONS).** Миграции
> **forward-only** (отката отдельных миграций нет — откат = восстановление из
> бэкапа + образ предыдущего SHA, см. §11). Порядок: **migrate-до-rollout**
> новых образов. Миграции должны быть additive/forward-compatible (не ломать
> работающие старые образы).

**Порядок применения (первый деплой и каждый subsequent deploy):**

```bash
# 1. Запустить PostgreSQL (если ещё не запущен):
docker compose -f infra/docker-compose.dev.yml up -d postgres
# (prod: docker compose -f infra/docker-compose.prod.yml up -d postgres pgbouncer)

# 2. Применить миграции (лексический порядок, каждый файл один раз):
npm run db:migrate

# 3. Верифицировать, что ВСЕ миграции применились:
npm run db:verify-migrations:all
```

**Ожидаемый результат:** `db:verify-migrations:all` подтверждает 38 миграций
(`001_core.sql` … `038_alertmanager_incidents.sql`).

Проверить количество вручную:

```bash
docker exec $(docker ps -q -f name=postgres) \
  psql -U arbibot -c "SELECT count(*) FROM schema_migrations;"
```

**Ожидаемый результат:** `38`.

> **Collision guard (D4-A-4-MIGRATIONS):** `db-migrate.mjs` автоматически
> прерывается с ошибкой, если два файла миграции имеют одинаковый 3-значный
> префикс (например, `037_a.sql` и `037_b.sql`). Это защищает от
> недетерминированного порядка применения. Если вы столкнулись с ошибкой
> коллизии — переименуйте один из файлов на следующий свободный номер.

**Migrate→rollout sequence (subsequent deploys):**

1. **Backup:** `npm run db:backup` (всегда перед миграцией).
2. **Migrate** (forward-only, additive): `npm run db:migrate` → старые образы
   продолжают работать на новой схеме.
3. **Verify:** `npm run db:verify-migrations:all`.
4. **Rollout** новых образов: `IMAGE_TAG=<sha> docker compose ... up -d`.
5. **Verify deployment:** `npm run verify:deployment`.

**Rollback (forward-only миграции):** откат отдельных миграций невозможен.
Процедура отката = восстановление БД из бэкапа + запуск образа предыдущего SHA
(см. §11 «Обновление и откат» и `npm run db:restore`).

**Renumbering existing environments:** если миграция была переименована
(например, `037_alertmanager_incidents.sql` → `038_alertmanager_incidents.sql`
в D4-A-4), на средах, где она уже применена под старым именем, `db:migrate`
применит её повторно под новым именем. Поскольку миграции идемпотентны
(`CREATE ... IF NOT EXISTS`), это безопасно (no-op). Чтобы убрать дубль в
`schema_migrations` (косметика, необязательно):

```sql
UPDATE schema_migrations SET filename = '038_alertmanager_incidents.sql'
WHERE filename = '037_alertmanager_incidents.sql';
```

### Шаг 2: Seed Canonical Registry

```bash
# Заполнить venue_refs, canonical_instruments, canonical_routes:
npm run db:seed-canonical
```

### Шаг 3: Seed Intake Policy Config (опционально)

```bash
# Начальная конфигурация intake throttling:
npm run seed:intake-policy-config
```

---

## 8. Верификация деплоя

### Автоматическая верификация

```bash
npm run verify:deployment
```

**Ожидаемый результат:**
```
╔══════════════════════════════════════════════════╗
║  Arbibot 2 — Deployment Verification            ║
╚══════════════════════════════════════════════════╝

━━━ Docker Containers ━━━
  ✓ postgres — container running
  ✓ redis — container running
  ✓ redpanda — container running
  ✓ risk-service — container running
  ... (все 22 контейнера)

━━━ HTTP Health Checks ━━━
  ✓ nginx-HTTP — HTTP 200
  ✓ risk-service — HTTP 200
  ✓ config-service — HTTP 200
  ...

━━━ Database ━━━
  ✓ PostgreSQL — 38 migrations applied

━━━ Redis ━━━
  ✓ Redis — PONG

━━━ Event Bus ━━━
  ✓ Redpanda — reachable

━━━ Observability ━━━
  ✓ Prometheus — HTTP 200
  ✓ Grafana — HTTP 200
  ✓ Alertmanager — HTTP 200

╔══════════════════════════════════════════════════╗
║  Verification Summary                            ║
║  PASS: 25                                        ║
║  FAIL: 0                                         ║
║  WARN: 2                                         ║
╚══════════════════════════════════════════════════╝

All checks passed — deployment is healthy
```

### Ручная верификация ключевых эндпоинтов

```bash
# Operator Dashboard (через nginx)
curl -sk https://localhost/api/health
# Ожидание: {"status":"ok"}

# Risk service
curl -s http://localhost:3000/metrics | head -5
# Ожидание: Prometheus metrics

# Health probes (D4-A-5-PROBES) — есть на каждом Nest-сервисе:
#   /health/live  — liveness (200 всегда, процесс жив)
#   /health/ready — readiness (200 если DB reachable, 503 если нет)
#   /health       — alias liveness (обратная совместимость)
curl -s http://localhost:3000/health/live   # {"ok":true}
curl -s http://localhost:3000/health/ready  # {"ok":true,"checks":{"database":{"ok":true,"latencyMs":N}}}
# При недоступной БД: /health/ready → 503 {"ok":false,"checks":{"database":{"ok":false,"error":"..."}}}

# Config service
curl -s http://localhost:3019/policy/configurations | jq '.[0].configKey'
# Ожидание: конфигурационные ключи

# Paper trading
curl -s http://localhost:3018/paper/trades | jq '.'
# Ожидание: [] (пока нет trades)

# Grafana
curl -sk https://localhost/grafana/ -u admin:YOUR_GRAFANA_PASSWORD
# Ожидание: HTML страница Grafana
```

---

## 9. Настройка Observability

### Grafana

1. Открыть `https://<YOUR_DOMAIN>/grafana/`
2. Логин: `admin` / пароль из `GRAFANA_ADMIN_PASSWORD`
3. Проверить datasources:
   - Prometheus: `http://prometheus:9090`
   - Loki: `http://loki:3100`
4. Открыть dashboards:
   - **SLO Overview** — общий обзор SLO
   - **Risk Policy Writers** — метрики risk-service
   - **Paper Trading** — paper trading мониторинг

### Prometheus

```bash
# Проверить targets:
curl -s http://localhost:9090/api/v1/targets | jq '.data.activeTargets | length'
# Ожидание: 12+ targets (все backend сервисы)
```

### Alertmanager

1. Настроить notifications в `infra/alertmanager/alertmanager.yml`:

```yaml
receivers:
  - name: 'slack'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK'
        channel: '#arbibot-alerts'
  
  - name: 'telegram'
    webhook_configs:
      - url: 'https://api.telegram.org/botYOUR_TOKEN/sendMessage?chat_id=YOUR_CHAT_ID'
```

2. Перезапустить alertmanager:

```bash
docker compose -f infra/docker-compose.prod.yml restart alertmanager
```

3. Проверить: `http://<HOST>:9093/#/alerts`

---

## 10. Функциональное тестирование

### Smoke Test 1: Создание snapshot

```bash
# Отправить market snapshot:
curl -s -X POST http://localhost:3015/market/snapshot \
  -H 'Content-Type: application/json' \
  -d '{
    "source": "binance",
    "instrumentKey": "BTC/USDT",
    "bid": 65000.0,
    "ask": 65001.0,
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }' | jq '.'
```

### Smoke Test 2: Risk Evaluation

```bash
curl -s -X POST http://localhost:3000/evaluate-risk \
  -H 'Content-Type: application/json' \
  -d '{
    "opportunityId": "test-opportunity-001",
    "instrumentKey": "BTC/USDT",
    "routeKey": "binance::spot",
    "estimatedProfitUsd": 10.0,
    "estimatedRiskScore": 0.3
  }' | jq '.'
```

### Smoke Test 3: Config CRUD

```bash
# Создать тестовую конфигурацию:
curl -s -X POST http://localhost:3019/policy/configurations \
  -H 'Content-Type: application/json' \
  -d '{
    "configKey": "test.deploy.smoke",
    "value": {"status": "ok"},
    "operatorId": "deploy-test"
  }' | jq '.'

# Прочитать:
curl -s http://localhost:3019/policy/configurations/test.deploy.smoke | jq '.'
```

### Smoke Test 4: Paper Trading

```bash
# Проверить paper trades (пока пустой):
curl -s http://localhost:3018/paper/trades | jq '.'

# Проверить discovery candidates:
curl -s http://localhost:3018/paper/discovery/candidates | jq '.'
```

### Smoke Test 5: Operator Dashboard

Открыть в браузере:

1. `https://<YOUR_DOMAIN>/` — редирект на `/dashboard`
2. `/dashboard` — сводная панель
3. `/paper` — paper trading раздел
4. `/settings` — конфигурации
5. `/execution` — планы исполнения
6. `/portfolio` — позиции

---

## 11. Обновление и откат

### Обновление (rolling deploy)

```bash
# 1. Собрать новые образы
git pull origin main
npm run docker:build

# 2. Обновить сервисы по группам (zero-downtime):

# Data layer (обычно не обновляется):
docker compose -f infra/docker-compose.prod.yml up -d postgres redis redpanda pgbouncer

# Core services:
docker compose -f infra/docker-compose.prod.yml up -d \
  risk-service config-service audit-service

# Dependent services:
docker compose -f infra/docker-compose.prod.yml up -d \
  capital-service opportunity-service market-intake-service \
  paper-trading-service reconciliation-service \
  execution-orchestrator HERMES-gateway \
  canonical-market-service portfolio-service

# Frontend + proxy:
docker compose -f infra/docker-compose.prod.yml up -d web nginx

# 3. Верифицировать:
npm run verify:deployment
```

### Откат на предыдущую версию

Начиная с `v0.1.0-paper` (D4-C-2-VERSIONING), каждый релиз тегируется semver-тегом
и образы в GHCR несут этот тег (`type=ref,event=tag` в `.github/workflows/cd.yml`).
Откат = фиксация `IMAGE_TAG` на предыдущем semver-теге. Список релизов — в
[`CHANGELOG.md`](../CHANGELOG.md), процедура — в [`docs/release-process.md`](release-process.md).

```bash
# 1. Остановить всё
docker compose -f infra/docker-compose.prod.yml down

# 2. Откат БД — forward-only (см. §7 и D4-A-3-RESTORE).
# Миграции НЕЛЬЗЯ откатить удалением строк из schema_migrations — DDL уже выполнен.
# Откат = восстановление БД из бэкапа:
npm run db:restore -- /path/to/backup.sql.gz
# или без confirm-prompt (автоматизация): npm run db:restore -- /path/to/backup.sql.gz --force
# После restore: npm run db:verify-migrations:all

# 3. Запустить с предыдущим semver-тегом (предпочтительно) или SHA:
IMAGE_TAG=v0.1.0-paper docker compose -f infra/docker-compose.prod.yml up -d
# Если откатываетесь на commit без semver-тега — используйте короткий SHA:
# IMAGE_TAG=<previous-sha> docker compose -f infra/docker-compose.prod.yml up -d

# 4. Верифицировать:
npm run verify:deployment
```

### Backup перед деплоем

```bash
# Создать backup БД:
npm run db:backup

# Backup хранится в backups/ с датой в имени файла
```

---

## 12. Решение проблем

### Контейнер не стартует

```bash
# Посмотреть логи:
docker compose -f infra/docker-compose.prod.yml logs <service-name>

# Последние 100 строк:
docker compose -f infra/docker-compose.prod.yml logs --tail 100 <service-name>

# Live логи:
docker compose -f infra/docker-compose.prod.yml logs -f <service-name>
```

### Health check падает

```bash
# Проверить вручную:
docker exec <container-id> wget -qO- http://localhost:<PORT>/metrics

# Проверить env внутри контейнера:
docker exec <container-id> env | grep -i PORT

# Перезапустить конкретный сервис:
docker compose -f infra/docker-compose.prod.yml restart <service-name>
```

### PostgreSQL недоступна

```bash
# Проверить статус:
docker exec $(docker ps -q -f name=postgres) pg_isready

# Проверить подключения:
docker exec $(docker ps -q -f name=postgres) \
  psql -U arbibot -c "SELECT count(*) FROM pg_stat_activity;"

# Проверить через PgBouncer:
docker exec $(docker ps -q -f name=pgbouncer) \
  psql "postgres://arbibot:${POSTGRES_PASSWORD}@postgres:5432/arbibot" \
  -c "SELECT 1;"
```

### Redis недоступен

```bash
docker exec $(docker ps -q -f name=redis) redis-cli ping
# Ожидание: PONG

# Проверить память:
docker exec $(docker ps -q -f name=redis) redis-cli info memory | grep used_memory_human
```

### Краспанда / Kafka проблемы

```bash
# Проверить статус:
docker exec $(docker ps -q -f name=redpanda) rpk cluster health

# Список topics:
docker exec $(docker ps -q -f name=redpanda) rpk topic list

# Создать topic вручную (если не создан):
docker exec $(docker ps -q -f name=redpanda) \
  rpk topic create arbibot.domain.events
```

### Nginx / HTTPS проблемы

```bash
# Проверить конфигурацию:
docker exec $(docker ps -q -f name=nginx) nginx -t

# Проверить сертификаты:
docker exec $(docker ps -q -f name=nginx) \
  ls -la /etc/nginx/ssl/

# Проверить proxy:
curl -sk https://localhost/ -v
```

### Все сервисы падают

```bash
# 1. Проверить память:
free -h
docker stats --no-stream

# 2. Проверить дисковое пространство:
df -h

# 3. Полный перезапуск:
docker compose -f infra/docker-compose.prod.yml down
docker compose -f infra/docker-compose.prod.yml up -d

# 4. Sequential start (если depends_on не справляется):
# Запускать группы сервисов по шагам (см. раздел 6)
```

---

## Приложение A: Использование Graphify

**Graphify** — knowledge graph кодовой базы Arbibot 2. Помогает анализировать зависимости сервисов, проверять границы и выявлять проблемы до деплоя.

### Обновление графа

```bash
npm run graphify:rebuild
```

### Query для проверки перед деплоем

```bash
# Проверить границы сервисов:
npm run graphify:query -- "Which services write to ExecutionPlan?"

# Проверить shared-package зависимости:
npm run graphify:query -- "What depends on @arbibot/persistence?"

# Полная диагностика:
npm run graphify:report
```

### Когда использовать

| Ситуация | Действие |
|----------|----------|
| Перед деплоем | `_rebuild_code` + проверить god nodes |
| После рефакторинга | `_rebuild_code` + проверить границы |
| Code review | Query конкретных зависимостей |
| Architecture review | Прочитать `GRAPH_REPORT.md` |
| После больших doc изменений | `/graphify . --update` в Cursor |

### Текущее состояние графа (2026-05-21)

- **Nodes:** 1694
- **Edges:** 1691  
- **Communities:** 417
- **Файлов:** 498

---

## Приложение B: Архитектура контейнеров

```
Internet
    │
    ▼
┌─────────┐
│  nginx   │ :80/:443 — TLS termination
└────┬─────┘
     │
     ▼
┌─────────┐
│   web    │ :3000 — Next.js Operator Dashboard
└────┬─────┘
     │ BFF (server-side fetch)
     ▼
┌──────────────────────────────────────────┐
│           Backend Services               │
│                                          │
│  risk-service            :3000           │
│  opportunity-service     :3010           │
│  capital-service         :3011           │
│  execution-orchestrator  :3012           │
│  audit-service           :3013           │
│  canonical-market-service:3014           │
│  market-intake-service   :3015           │
│  portfolio-service       :3016           │
│  reconciliation-service  :3017           │
│  paper-trading-service   :3018           │
│  config-service          :3019           │
│  HERMES-gateway        :3020           │
└───────┬──────────┬──────────┬────────────┘
        │          │          │
   ┌────▼──┐  ┌───▼───┐  ┌──▼───────┐
   │  PgB  │  │ Redis │  │ Redpanda │
   │ouncer │  │  :6379│  │  :9092   │
   └───┬───┘  └───────┘  └──────────┘
       │
   ┌───▼────┐
   │Postgres│ :5432
   │   16   │
   └────────┘

┌──────────────────────────────────┐
│      Observability Stack         │
│                                  │
│  Prometheus :9090                │
│  Grafana    :3000 (internal)     │
│  Loki       :3100                │
│  Promtail                       │
│  Alertmanager :9093             │
└──────────────────────────────────┘
```

## Приложение C: Быстрая шпаргалка

| Команда | Назначение |
|---------|-----------|
| `npm run verify:env` | Проверить .env перед деплоем |
| `npm run docker:build` | Собрать все Docker-образы |
| `npm run generate:tls` | Создать self-signed TLS |
| `npm run db:migrate` | Применить SQL-миграции |
| `npm run db:seed-canonical` | Заполнить canonical registry |
| `npm run seed:intake-policy-config` | Начальная конфигурация intake |
| `npm run verify:deployment` | Полная верификация деплоя |
| `npm run db:backup` | Backup PostgreSQL |
| `docker compose -f infra/docker-compose.prod.yml logs -f` | Live логи всех сервисов |
| `docker compose -f infra/docker-compose.prod.yml ps` | Статус контейнеров |
| `docker compose -f infra/docker-compose.prod.yml restart <svc>` | Перезапуск сервиса |

## Приложение D: Первый деплой (copy-paste)

```bash
# ═══ Полная последовательность первого деплоя ═══

# 1. Подготовка
git clone git@github.com:brev77/Arbibot-2.git && cd Arbibot-2
npm ci
npm run build && npm run lint && npm run test

# 2. Конфигурация
cp .env.production.example .env
# → Редактировать .env: заполнить ВСЕ <CHANGE_ME_USE_VAULT>
npm run verify:env

# 3. TLS
mkdir -p infra/nginx/ssl
npm run generate:tls  # или Let's Encrypt

# 4. Сборка
npm run docker:build

# 5. Запуск (последовательный)
docker compose -f infra/docker-compose.prod.yml up -d postgres redis redpanda pgbouncer
sleep 30
docker compose -f infra/docker-compose.prod.yml up -d \
  risk-service config-service audit-service canonical-market-service portfolio-service
sleep 30
docker compose -f infra/docker-compose.prod.yml up -d \
  capital-service opportunity-service market-intake-service \
  paper-trading-service reconciliation-service \
  execution-orchestrator HERMES-gateway
sleep 30
docker compose -f infra/docker-compose.prod.yml up -d \
  web prometheus grafana loki promtail alertmanager nginx

# 6. Инициализация данных
npm run db:seed-canonical
npm run seed:intake-policy-config

# 7. Верификация
npm run verify:deployment

# ═══ Готово! ═══
# Dashboard: https://<YOUR_DOMAIN>/
# Grafana:   https://<YOUR_DOMAIN>/grafana/