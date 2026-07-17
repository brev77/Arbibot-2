# 07 — Секреты, настройка системы, мониторинг

Под «ботом» здесь имеется в виду **торговый контур Arbibot 2** (политики, лимиты, флаги окружения), а не отдельный чат-бот.

## 1. Куда вносить чувствительную информацию

| Где | Назначение |
|-----|------------|
| **`.env` в корне репозитория** | Локальная разработка. Создайте копией [`.env.example`](../../.env.example). Файл **не коммитится** (см. `.gitignore`: `.env`, `.env.*`). |
| **Секреты CI/CD** | GitHub Actions Secrets, Vault, Kubernetes Secret и т.п. — те же **имена** переменных, что в `.env.example`, без хранения значений в Git. |
| **Не класть** | Пароли, API-ключи и токены в код, в PR, в скриншоты, в логи приложений. |

Категории переменных (полный перечень и комментарии — только в `.env.example`):

- Подключения: **`DATABASE_URL`**, **`REDIS_URL`**, при bus — **`KAFKA_BROKERS`** / топик.
- Ключи и токены доступа: например **`HERMES_API_KEYS`**, **`HERMES_BFF_API_KEY`**, **`RISK_POLICY_JOB_TRIGGER_TOKEN`**, **`PAPER_DISCOVERY_RUN_TOKEN`** — включайте по мере использования фич.
- Прод-браузер: **`CORS_ORIGINS`** (явный список origin для Nest).
- Будущие пароли к внешним venue — только через секреты окружения, не в репозиторий.

Мутации в **config-service** требуют **`operatorId`** в теле; в dev для стабильного аудита можно задать **`ARBIBOT_DEV_OPERATOR_ID`** (см. [AGENTS.md](../../AGENTS.md)).

Базовые требования безопасности: [docs/security-baseline.md](../security-baseline.md).

## 2. Как настраивать поведение системы (слои)

### Слой A — переменные окружения

Шаблон и пояснения — [`.env.example`](../../.env.example). Там же межсервисные URL (`RISK_SERVICE_URL`, `PAPER_TRADING_SERVICE_URL`, `CONFIG_SERVICE_URL`, `*_API_BASE` для web BFF), порты, флаги:

- **`OUTBOX_RELAY_ENABLED`** — релей opportunity → paper/risk-потоки.
- **`RISK_POLICY_JOBS_ENABLED`** — фоновые job-ы risk (по умолчанию выкл. в dev).
- **`INTAKE_THROTTLING_ENABLED`** — throttling в market-intake (Phase 4).
- **`PAPER_DISCOVERY_*`**, **`INTAKE_POLICY_*`** — см. комментарии в `.env.example`.

Таблица портов по умолчанию — [README.md](../../README.md).

### Слой B — управляемые политики (config-service + UI `/settings`)

Версионируемые ключи конфигурации: например **`paper.discovery`**, **`intake.throttling`**, **`intake.routing.tiers`**. Чувствительные шаблоны ключей **`risk.*`**, **`execution.*`**, **`capital.*`** при мутациях требуют **`approveReason`** (см. [AGENTS.md](../../AGENTS.md), раздел config-service).

Документы:

- [docs/cfg-3-staged-rollout.md](../cfg-3-staged-rollout.md) — promote / activate draft.
- [docs/paper-discovery-config-keys.md](../paper-discovery-config-keys.md) — paper discovery.
- [docs/intake-policy-config-keys.md](../intake-policy-config-keys.md) — intake policy JSON.

### Слой C — справочник рынка

После миграций **канонические таблицы** заполняются **вручную**; без этого resolve-эндпоинты неполезны. См. *Seed note* в [README.md](../../README.md).

### Слой D — HERMES и BFF

Переменные **`HERMES_*`**, **`OPERATOR_WEB_BFF_BASE`** и смежные — в хвосте `.env.example` и в [apps/hermes-gateway/README.md](../../apps/hermes-gateway/README.md).

## 3. За какими данными следить (операторский чеклист)

| Область | Что смотреть |
|---------|----------------|
| **Здоровье сервисов** | `GET /metrics` на поднятых Nest-приложениях; дашборды Grafana — [infra/grafana/dashboards/](../../infra/grafana/dashboards/), гайд [grafana-dashboard-verification.md](../grafana-dashboard-verification.md). |
| **Сводка в UI** | `/dashboard` — инциденты, капитал, при Phase 4 — сигнал деградации intake (см. BFF в AGENTS). |
| **Paper** | `/paper` и связанные разделы — сделки, promotion, drift, discovery. |
| **Инциденты и процедуры** | `/incidents`, `/runbooks`; сверка — [reconciliation-p0-procedures.md](../reconciliation-p0-procedures.md). |
| **Политики** | `/settings` и эффективные значения через BFF config-service. |
| **Доставка событий** | Очередь outbox, relay vs Kafka bridge — [outbox-inbox.md](../outbox-inbox.md); не смешивать allowlist типов событий. |
| **SLO и трейсы** | [observability-tracing.md](../observability-tracing.md). |
| **Регресс функционала** | Карта E2E — [04 — тестирование и CI](04-testing-and-ci.md), сценарии — [e2e-scenarios.md](../e2e-scenarios.md). |

Локальный старт окружения: [03 — локальная разработка](03-local-dev.md).
