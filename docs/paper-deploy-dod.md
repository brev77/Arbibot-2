# Paper-Deploy Definition of Done (DoD) — Phase A gate

**Связанный шаг:** [`D4-A-7-PAPER-SMOKE`](../.cursor/plans/deploy-readiness/D4-A-7-PAPER-SMOKE.md)
**Дата создания:** 2026-07-12
**Назначение:** финальный гейт Фазы A плана 4 (Deployment Readiness). Подтверждает, что
изолированный paper-deploy проходит end-to-end после закрытия блокеров P1/P2/P3/P7/P8/P9.
**Статус:** чеклист готов; прогон на целевом paper-хосте — операционная задача (требует
хоста с БД, Docker, настроенными Slack/PagerDuty secrets).

---

## Предусловия

- [ ] Целевой paper-хост подготовлен по [`docs/deployment-guide.md`](deployment-guide.md):
      Docker, `npm ci`, `.env` из `.env.production.example` заполнен.
- [ ] Секреты из Фазы A установлены в `.env`:
      - `OPERATOR_SESSION_SECRET` (≥32 байта, D4-A-1-AUTH)
      - `OPERATOR_BOOTSTRAP_TOKEN` (D4-A-1-AUTH)
      - `SLACK_WEBHOOK_URL` и/или `PAGERDUTY_ROUTING_KEY` (D4-A-2-PAGING)
- [ ] Миграции применены: `npm run db:migrate` → `npm run db:verify-migrations:all`
      (38 миграций, D4-A-4-MIGRATIONS).
- [ ] TLS-сертификаты в `infra/nginx/ssl/` (D4-A-6-TLS). Для paper: либо self-signed
      + импорт CA в браузер, либо Let's Encrypt. HSTS закомментирован для self-signed.

---

## DoD-чеклист (прогнать на paper-хосте по порядку)

### 1. Стек поднимается зелёным
```bash
docker compose -f infra/docker-compose.prod.yml up -d
docker compose -f infra/docker-compose.prod.yml ps   # все 22 контейнера Up/healthy
```
- [ ] Все контейнеры `Up` или `Up (healthy)`. Никаких `Restarting`/`Exited`.
- [ ] `depends_on: service_healthy` цепочки прошли (сервисы стартуют после ready-dependencies).

### 2. Readiness probes
```bash
# Каждый Nest-сервис отвечает /health/ready 200 (D4-A-5-PROBES):
for port in 3000 3010 3011 3012 3013 3014 3015 3016 3017 3018 3019 3020; do
  echo -n "port $port: "; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:$port/health/ready
done
# Ожидание: 200 для каждого. 503 = зависимость (DB/Redis) упала — смотреть checks в теле.
```
- [ ] Все `/health/ready` → 200.
- [ ] `/health/live` → 200 (liveness, без зависимостей).
- [ ] `npm run verify:deployment` → "All checks passed — deployment is healthy".

### 3. Миграции
```bash
npm run db:verify-migrations:all
# Ожидание: 38 миграций (001_core … 038_alertmanager_incidents).
```
- [ ] Все 38 миграций применены.

### 4. Окружение
```bash
npm run verify:env
# Ожидание: 0 FAIL (warnings допустимы).
```
- [ ] Нет `FAIL`. `ARBIBOT_DEV_ROLE` НЕ установлен (prod guard).
- [ ] `OPERATOR_SESSION_SECRET`, `OPERATOR_BOOTSTRAP_TOKEN` установлены и ≥32 байт / не placeholder.
- [ ] Paging secrets (`SLACK_WEBHOOK_URL` / `PAGERDUTY_ROUTING_KEY`) — хотя бы один установлен.

### 5. Operator auth (D4-A-1-AUTH)
- [ ] `https://<host>/login` отображает форму входа (bootstrap token + role).
- [ ] `POST /api/auth/session` с верным `OPERATOR_BOOTSTRAP_TOKEN` → ставит подписанную `arbibot_session` куку → redirect на `/dashboard`.
- [ ] **Подделанная `arbibot_role=admin` кука НЕ даёт доступ** — без подписанной `arbibot_session` BFF/middleware отдаёт 401/redirect на `/login`.
- [ ] `DELETE /api/auth/session` — logout (кука очищена).

### 6. Paging (D4-A-2-PAGING)
- [ ] Тестовый critical-алёрт доходит до Slack-канала (`#arbibot-critical`) и/или PagerDuty.
      Способ: `curl -X POST http://localhost:9093/api/v2/alerts ...` с `severity: critical`,
      либо временно изменить alert rule `expr` для немедленного срабатывания.
- [ ] Алёрт появляется в `/incidents` UI (audit-trail через `arbibot-incidents` receiver → reconciliation-service).

### 7. Backup + restore (D4-A-3-RESTORE)
```bash
npm run db:backup                                         # свежий бэкап
LATEST=$(ls -t backups/*.sql.gz | head -1)
npm run db:restore -- "$LATEST" --force                   # restore в тестовую БД
npm run db:verify-migrations:all                          # состояние восстановлено
```
- [ ] `db:backup` создаёт `backups/arbibot_<ts>.sql.gz`.
- [ ] `db:restore` восстанавливает БД (confirm-prompt пропущен через `--force`).
- [ ] После restore — 38 миграций на месте.

### 8. TLS (D4-A-6-TLS)
- [ ] `https://<host>/` открывается без browser-warning (валидный сертификат или импортированный self-signed CA).
- [ ] Для self-signed: HSTS закомментирован в `infra/nginx/nginx.conf` (проверить `grep Strict-Transport`).

### 9. Paper trading E2E
```bash
# Против прод-хоста (переопределить URLs):
PAPER_API_BASE=https://<host>/api PAPER_TRADING_SERVICE_URL=http://<host>:3018 \
  npm run e2e:phase3-paper-promotion
```
- [ ] E2E проходит: opportunity → paper-enqueue → promotion-candidate → paper trade.

### 10. Observability
- [ ] Grafana (`https://<host>/grafana/`): все 7 дашбордов показывают данные.
- [ ] Prometheus (`/prometheus/`): target'ы `up` для всех сервисов.
- [ ] `/metrics` каждого сервиса отдаёт Prometheus-метрики.

---

## Результат

После полного прогона записать результат в `docs/paper-deploy-smoke-<date>.md`:
- Дата, хост, версия образов (`IMAGE_TAG`).
- Статус каждого пункта (✅/❌).
- Найденные проблемы → либо устранены, либо заведены как backlog-задачи
  (ссылка на issue/`DEVELOPMENT_PLAN4.md`).
- Подпись: «Paper-deploy DoD пройден — готов к приёмке → переход к Фазе B (live-gate)».

**Гейт:** пока ВСЕ пункты не ✅, переход к Фазе B (`D4-B-*` live-gate) запрещён.
Фаза B закрывает капитально-критичные контроли (L1–L8) — её нельзя начинать на
paper-хосте, где базовая операционная готовность не подтверждена.

---

## Rollback при провале

Smoke не меняет код. При провале откатить образы к предыдущему SHA:
```bash
IMAGE_TAG=<previous-sha> docker compose -f infra/docker-compose.prod.yml up -d
npm run db:restore -- backups/arbibot_<pre-deploy-ts>.sql.gz --force   # если миграции откатывались
```
