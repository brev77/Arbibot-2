# Drill #1 — Paper incident (drift high)

**Тип:** на стресс-реакцию on-call.
**Цель:** проверить, что цепочка `paper drift samples → Prometheus → Alertmanager → Operator → /incidents` работает
 end-to-end в реалистичных временных рамках, до того как случится настоящий incident.

## Когда запускать

| Триггер | Срок |
|---------|------|
| После 1-й недели в paper trading | mandatory |
| После любого изменения в `infra/prometheus/alerts.yml`, `infra/grafana/recording-rules/*`, `paper-trading-service` metrics | mandatory |
| Регулярная репетиция (on-call rotation) | ежеквартально |

## Критерии успеха (DoD)

| # | Критерий | Целевое время |
|---|----------|---------------|
| 1 | Alert `PaperDriftBpsHigh` переходит в `firing` после инъекции | ≤ 10 m |
| 2 | Alert доставлен в Alertmanager (`/api/v2/alerts?active=true`) | ≤ 10 m |
| 3 | Уведомление пришло в Slack/Telegram (webhook receiver) | ≤ 12 m |
| 4 | Оператор увидел incident в `/incidents` Operator Web | ≤ 15 m |
| 5 | Оператор эскалировал: `open → investigating → resolved` | ≤ 30 m total |

## Prerequisites

Локальный dev/preview-стенд (минимум):

```bash
# 1. Запустить dev-стек (Postgres 15432 + Redis + опционально bus)
docker compose -f infra/docker-compose.dev.yml --profile bus up -d

# 2. Применить миграции (016–028 — drift + recording)
npm run db:migrate

# 3. Поднять сервисы (отдельные терминалы или background)
npm run dev:paper          # paper-trading-service :3018
npm run dev:opportunity    # opportunity-service :3010  (необязательно для drill)

# 4. Поднять observability stack (Prometheus + Alertmanager)
docker compose -f infra/docker-compose.dev.yml --profile observability up -d
# (или локально: prometheus --config.file=infra/prometheus/prometheus.yml)
```

Проверить readiness:
- `curl http://127.0.0.1:3018/health` → `{"status":"ok"}`
- `curl http://127.0.0.1:9090/-/ready` → `Prometheus is Ready.`
- `curl http://127.0.0.1:9093/-/ready` → `OK`

## Запуск drill'а

### Автоматическая часть (симулятор)

```bash
# Полный прогон с инъекцией 75 bps drift, ожидание firing ~7m
npm run drill:1

# Или напрямую:
node tools/drill-1-paper-incident.mjs

# Сухой прогон (только preflight, без инъекции в БД)
DRILL_DRY_RUN=true npm run drill:1

# Свои параметры
DRILL_INSTRUMENT_KEY=DRILL-ETH-USDC \
DRILL_TARGET_BPS=80 \
DRILL_SETTLE_SECONDS=600 \
  npm run drill:1
```

Скрипт делает:
1. Preflight: ping paper-trading, prometheus, alertmanager.
2. Проверяет что alert rule `PaperDriftBpsHigh` загружен в Prometheus.
3. Снимает baseline метрик (`arb_paper_drift_bps_current`, `arb_paper_drift_bps_avg_5m`).
4. **Инжектирует** 12 drift samples через SQL в `paper_drift_samples` (instrument `DRILL-BTC-USDC`, drift ≈ 75 bps).
5. Каждые 15 s опрашивает Prometheus + Alertmanager до тех пор, пока:
   - `ALERTS{PaperDriftBpsHigh, firing}` не появится в Prometheus,
   - и алерт не появится в Alertmanager `/api/v2/alerts?active=true`.
6. Печатает pass/fail-отчёт + troubleshooting.

### Ручная часть (оператор)

После того как скрипт сказал `AUTOMATED PART passed`:

1. **Открыть Operator Web** → `/incidents`.
2. **Подтвердить**, что incident `PaperDriftBpsHigh` отображается как `open`.
3. **Эскалировать** через UI:
   - `open` → `investigating` (отметить что это drill в комментариях).
   - `investigating` → `resolved` (причина: `drill — симуляция высокого drift`).
4. **Проверить Slack/Telegram**: пришло ли уведомление от Alertmanager receiver.
5. **Зафиксировать MTTA / MTTR** в логе drill'а (см. ниже).

### Cleanup

```sql
-- Удалить инжектированные drill-сэмплы
DELETE FROM paper_drift_samples WHERE instrument_key LIKE 'DRILL-%';
```

## Лог drill'а

После каждого прогона добавляйте запись в раздел «История прогонов» ниже (или в `docs/TODO.md`):

```markdown
| Дата | Operator | Базовый avg5m | MTTA | MTTR | Результат | Замечания |
|------|----------|---------------|------|------|-----------|-----------|
| YYYY-MM-DD | @operator | 8 bps | 6 m | 18 m | PASS | Slack webhook застрял, restart alertmanager |
```

Поля:
- **MTTA** — от момента firing в Prometheus до того как оператор увидел/открыл incident.
- **MTTR** — от firing до перевода в `resolved`.

## Troubleshooting

### Alert не firing в Prometheus
1. Проверить что `arb_paper_drift_bps_current` вообще публикуется:
   ```bash
   curl -s http://127.0.0.1:3018/metrics | grep paper_drift
   ```
2. Проверить `updateStaleGauges()` — он должен вызываться периодически
   (метрика `arb_paper_drift_samples_p95_rate_1h` должна расти).
3. Проверить scrape-конфиг в `infra/prometheus/prometheus.yml` —
   paper-trading-service должен быть в `scrape_configs`.
4. Увеличить `DRILL_SETTLE_SECONDS` если scrape_interval длиннее 15s.

### Alert firing в Prometheus, но не в Alertmanager
1. Проверить `alerting.alertmanagers` в `infra/prometheus/prometheus.yml`.
2. Проверить `/api/v1/status/config` Prometheus — фактически ли загружен config.
3. Посмотреть логи Alertmanager (`docker logs alertmanager`).

### Alertmanager получил алерт, но Slack/Telegram молчит
1. Проверить `receivers` в `infra/alertmanager/config.yml`.
2. Проверить env-переменные вебхука (`SLACK_WEBHOOK_URL`, `TELEGRAM_BOT_TOKEN`).
3. Посмотреть Alertmanager `/-/healthy` и `/api/v2/status`.

### Incident не отображается в Operator Web `/incidents`
1. Проверить BFF-эндпоинт: `GET /api/operator/incidents`.
2. Проверить что `paper-trading-service` или отдельный incident-source публикует
   событие в `incidents`-таблицу или шлёт webhook (зависит от интеграции).
3. **Note**: если Drill #1 используется до реализации полноценного incident-пайплайна,
   operator может вручную создать incident через `POST /incidents` для проверки UI-флоу.

## Связанные документы

- [`docs/TODO.md`](TODO.md) — таблица drills (триггеры / критерии)
- [`docs/incident-response-playbook.md`](incident-response-playbook.md) — операторский playbook
- [`docs/paper-promotion-criteria.md`](paper-promotion-criteria.md) — критерии качества paper trading
- [`infra/prometheus/alerts.yml`](../infra/prometheus/alerts.yml) — alert rules
- [`infra/grafana/recording-rules/paper-drift-recording.yml`](../infra/grafana/recording-rules/paper-drift-recording.yml) — recording rules
- [`docs/observability-tracing.md`](observability-tracing.md) — observability overview

## История прогонов

| Дата | Operator | Baseline avg5m | MTTA | MTTR | Результат | Замечания |
|------|----------|----------------|------|------|-----------|-----------|
| _пока не запускался_ | — | — | — | — | — | — |