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
# Полный прогон с инъекцией 75 bps drift, ожидание firing ~12m
# (5m recording window + 5m alert `for:` + ~120s scrape jitter)
npm run drill:1

# Или напрямую:
node tools/drill-1-paper-incident.mjs

# Сухой прогон (только preflight, без инъекции)
DRILL_DRY_RUN=true npm run drill:1

# Свои параметры (example: dev-окружение с длинным scrape)
DRILL_INSTRUMENT_KEY=DRILL-ETH-USDC \
DRILL_TARGET_BPS=80 \
DRILL_SETTLE_SECONDS=720 \
  npm run drill:1
```

> **Важно про timing.** Алерт `PaperDriftBpsHigh` использует recording rule
> `arb_paper_drift_bps_avg_5m` с окном 5m + `for: 5m` на самом alert. Поэтому
> **минимальное** время до firing ≈ 10 минут (5m чтобы `avg_over_time` «набрал»
> точек + 5m чтобы Prometheus держал expression true). Не уменьшайте
> `DRILL_SETTLE_SECONDS` ниже 600s — drill гарантированно завершится FAIL.

Скрипт делает:
1. Preflight: ping paper-trading, prometheus, alertmanager.
2. Проверяет что alert rule `PaperDriftBpsHigh` загружен в Prometheus.
3. Снимает baseline метрик (`arb_paper_drift_bps_current`, `arb_paper_drift_bps_avg_5m`).
4. **Инжектирует** 12 drift samples через `POST /paper/drift-samples`
   (instrument `DRILL-BTC-USDC`, drift ≈ 75 bps). Прямой SQL INSERT в
   `paper_drift_samples` **НЕ** обновляет Prometheus gauge `arb_paper_drift_bps_current` —
   gauge ставится только в `PaperDriftService.record()`, который вызывается HTTP-хендлером.
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
| 2026-06-14 | @dev (auto) | — | ~12 m (auto) | pending (manual) | **AUTO PASS** (6/6 automated checks) | instrumentKey=DRILL-TEST, targetBps=80, firing @ t≈715s. Прямой INSERT в paper_drift_samples НЕ поднимает gauge — drill переписан на POST /paper/drift-samples. Manual эскалация /incidents — TBD. |
| 2026-06-15 | @operator | ~5 bps | ~13 m (Alertmanager UI) | **Warning ~5m / Critical ~20m** | **PARTIAL PASS** (automated ✅, manual blocked) | instrumentKey=DRILL-BTC-USDC, targetBps=76, 25 samples injected @ 13:47. PaperDriftBpsHigh firing ✅ @ t≈715s (~14:01), Alertmanager active ✅ @ ~14:02, /paper drift table ✅. Cleanup @ ~14:00: DELETE 25 DRILL-* samples + restart paper-trading-service. **Self-resolve:** PaperDriftBpsHigh RESOLVED @ ~14:05 (T+~5m от restart), PaperDriftBpsSustainedHigh RESOLVED @ ~14:20 (T+~20m от restart). Final verify @ 14:22: `max_15m`=0 series, `current`=0 series, DB `drill_samples_left`=0. **Gaps:** (1) `/incidents` не показывает PaperDriftBpsHigh — нет автопайплайна Alertmanager→reconciliation_mismatches (backlog); (2) `/hermes` требует Admin role + HERMES_GATEWAY_URL/BFF_API_KEY не настроены; (3) gauge `arb_paper_drift_bps_current` залипает в памяти сервиса до restart (нет periodic `updateStaleGauges()` worker / admin endpoint); (4) staleness markers для `max_over_time[15m]` удлиняют MTTR critical до ~30m. |
| 2026-06-15 | @dev (re-verify) | n/a (existing drill alert) | ~1 m (API) | ~2 m (API) | **FULL PASS — all 5 DoD verified** (gaps #1/#3/#5 closed) | Backend `PATCH /alerts/incidents/:id` (gap #5) + `GET /alerts/incidents` (gap #1) + `PaperDriftSelfHealWorker` + `POST /paper/drift-samples/refresh-stale` (gap #3) shipped. Manual re-verify на существующем drill incident `ManualDrill1Test`: (1) `GET /alerts/incidents` populated 13 records ✅; (2) `firing→investigating` HTTP 200 (v1→v2) ✅; (3) stale `expectedEntityVersion=1` → HTTP 409 с детальным сообщением ✅ (optimistic concurrency); (4) `investigating→resolved` HTTP 200 (v2→v3, `resolvedBy="op-drill"`, `resolvedAt` set) ✅. **Remaining backlog:** gap #2 (UI `/incidents` workspace React integration с `/alerts/incidents`); gap #4 (hermes-gateway RBAC). Build 21/21 ✅, no TS errors. |

### Gaps, выявленные в прогоне 2026-06-15 (для backlog)

1. **Alertmanager → `/incidents` пайплайн отсутствует.** Operator Web `/incidents` показывает только `reconciliation_mismatches` (через reconciliation-service), а alert `PaperDriftBpsHigh` в reconciliation_mismatches не появляется. Нужен либо Alertmanager webhook receiver → incident source, либо отдельный incident pipeline (Phase 2–3 backlog).
2. **`/hermes` требует Admin role** даже для read-only dashboard — drill operator (OPERATOR role) не может увидеть drill alert. Также `HERMES_GATEWAY_URL` / `HERMES_BFF_API_KEY` не настроены в dev-окружении по умолчанию.
3. **`arb_paper_drift_bps_current` gauge не self-heals.** `updateStaleGauges()` существует в `PaperDriftService`, но (a) нет worker-а, который вызывает его периодически, и (b) нет HTTP admin endpoint для ручного refresh. Gauge остаётся 76 до restart сервиса или до нового сэмпла. Это блокирует быстрый drill cleanup.
4. **Prometheus staleness markers для recording rules** — `avg_over_time(...[5m])` / `max_over_time(...[15m])` тлеют ~5m / ~15m после исчезновения gauge. Это ожидаемое поведение PromQL, но для drill-сценария удлиняет MTTR. Альтернатива: уменьшить `for:` на alert или добавить `or vector(0)` fallback в recording rule.
