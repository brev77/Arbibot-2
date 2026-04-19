# Локальный прогон `ci:e2e-phase3` (Phase 3 paper promotion)

Повторяет job **`e2e-phase3-paper-promotion`** из [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): Postgres → миграции → `paper-trading-service` + `opportunity-service` → smoke [`e2e:phase3-paper-promotion`](../tools/e2e-phase3-paper-promotion.mjs).

Скрипт-обёртка: [`tools/ci-e2e-phase3-paper-promotion.sh`](../tools/ci-e2e-phase3-paper-promotion.sh) (вызывается через `npm run ci:e2e-phase3`).

## Требования

- **Node.js** ≥ 22 (см. `package.json` → `engines`).
- **Bash** и **curl** (на Windows: Git Bash или WSL; `npm run ci:e2e-phase3` вызывает `bash`).
- Свободные порты **3010** и **3018** на `127.0.0.1`.
- **PostgreSQL** с БД и учёткой, совместимыми с `DATABASE_URL` (ниже — значения по умолчанию).

## Вариант A — как в CI (Postgres на `127.0.0.1:5432`)

### 1. Зависимости и сборка

```bash
cd /path/to/Arbibot-2
npm ci
npm run build
```

Без `build` не появятся `apps/paper-trading-service/dist/main.js` и `apps/opportunity-service/dist/main.js`, которые поднимает CI-скрипт.

### 2. Postgres

**Локальный Postgres** с пользователем `arbibot`, паролем `arbibot`, базой `arbibot`, слушающий **5432** на localhost.

**Или Docker** (порт на хосте как в CI):

```bash
docker run -d --name arbibot-ci-pg \
  -e POSTGRES_USER=arbibot \
  -e POSTGRES_PASSWORD=arbibot \
  -e POSTGRES_DB=arbibot \
  -p 5432:5432 \
  postgres:16-alpine

until docker exec arbibot-ci-pg pg_isready -U arbibot -d arbibot; do sleep 1; done
```

Если порт **5432** занят, освободите его или используйте [вариант B](#вариант-b--postgres-из-infra-на-порту-15432).

### 3. Переменные окружения (опционально)

Скрипт задаёт по умолчанию:

| Переменная | Значение по умолчанию |
|------------|------------------------|
| `DATABASE_URL` | `postgres://arbibot:arbibot@127.0.0.1:5432/arbibot` |
| `PAPER_TRADING_SERVICE_URL` | `http://127.0.0.1:3018` |
| `OUTBOX_RELAY_POLL_MS` | `400` |
| `PAPER_DISCOVERY_POLL_MS` | `0` |
| `PAPER_DISCOVERY_RUN_TOKEN` | `ci-paper-discovery` |

### 4. Запуск

```bash
export DATABASE_URL=postgres://arbibot:arbibot@127.0.0.1:5432/arbibot
npm run ci:e2e-phase3
```

Внутри выполняется: `npm run db:migrate` → фоновый paper (3018) и opportunity (3010) → ожидание `GET /metrics` на обоих портах → `npm run e2e:phase3-paper-promotion`.

### 5. Критерии успеха

- Процесс завершается с **кодом 0**.
- Подробнее см. таблицу в [README.md](../README.md) (раздел «Скрипты в корне»): метрики, `paper-enqueue`, dedup второго запроса, появление записи в `GET …/paper/promotion-candidates` с тем же `opportunityId` в течение ~20 с.

### 6. Логи при ошибке

```bash
tail -n 80 /tmp/arbibot-e2e-phase3-paper.log
tail -n 80 /tmp/arbibot-e2e-phase3-opportunity.log
```

### 7. Очистка контейнера Postgres

```bash
docker rm -f arbibot-ci-pg
```

---

## Вариант B — Postgres из `infra` (порт **15432**)

Поднять только Postgres:

```bash
docker compose -f infra/docker-compose.dev.yml up -d postgres
```

Дождаться healthy (или `pg_isready` к `127.0.0.1:15432`).

Запуск:

```bash
export DATABASE_URL=postgres://arbibot:arbibot@127.0.0.1:15432/arbibot
npm run ci:e2e-phase3
```

---

## Windows без WSL

1. Установите **Node 22** и **Git for Windows** (bash + curl).
2. Откройте репозиторий в **Git Bash** и выполните шаги варианта A или B.
3. **Не** рекомендуется запускать в Docker-контейнере с bind-mount всего репозитория с диска `C:` и выполнять там `npm ci` — на Docker Desktop это обычно очень медленно. Надёжнее выполнять `npm ci` / `npm run build` / `npm run ci:e2e-phase3` **на хосте** в Git Bash или в WSL.

---

## Только smoke без CI-обёртки

Если сервисы уже запущены вручную с нужными `PORT`, `DATABASE_URL`, `PAPER_TRADING_SERVICE_URL` и т.д.:

```bash
export OPPORTUNITY_SERVICE_URL=http://127.0.0.1:3010
export PAPER_TRADING_SERVICE_URL=http://127.0.0.1:3018
npm run e2e:phase3-paper-promotion
```

Полный сценарий «как в CI» — **`npm run ci:e2e-phase3`**.

---

## Ссылка на CI

Фрагмент workflow: после `npm ci` и `npm run build` выполняется:

```yaml
env:
  DATABASE_URL: postgres://arbibot:arbibot@127.0.0.1:5432/arbibot
run: bash tools/ci-e2e-phase3-paper-promotion.sh
```

Это эквивалентно `npm run ci:e2e-phase3` из корня репозитория.
