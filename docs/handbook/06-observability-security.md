# 06 — Observability и security

## Метрики и трассировка

- Nest-сервисы отдают **Prometheus** на `GET /metrics` через `@arbibot/nest-platform` (единый реестр `getArbibotMetricsRegistry()` — см. код и [AGENTS.md](../../AGENTS.md)).
- SLO, тиры латентности, корреляция запросов — [docs/observability-tracing.md](../observability-tracing.md).
- Базовый обзор — [docs/observability-baseline.md](../observability-baseline.md).

## Дашборды

- JSON-дашборды: [infra/grafana/dashboards/](../../infra/grafana/dashboards/).
- Проверка панелей — [docs/grafana-dashboard-verification.md](../grafana-dashboard-verification.md).
- Кратко по intake / writers — [infra/grafana/README.md](../../infra/grafana/README.md).

## Security baseline

- Политика и чеклисты — [docs/security-baseline.md](../security-baseline.md).
- Секреты и env — [07 — секреты, настройка, мониторинг](07-secrets-config-and-monitoring.md).

## Outbox и bus

Наблюдаемость доставки событий и чеклист smoke — [docs/outbox-inbox.md](../outbox-inbox.md), [docs/phase4-prep-bridge.md](../phase4-prep-bridge.md).

Назад к операторскому контуру: [05 — оператор и runbooks](05-operator-runbooks.md).
