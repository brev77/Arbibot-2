# Review gate: CFG-3 UI + paper discovery × config (2026-04-19)

Чеклист перед переводом **`PRIO-P2-PAPERDISC`** в `review_passed` / `done` и для релизного CFG-3.

## Backend (`paper-trading-service`)

- [x] Прогнать skill **backend-review-agent** (или `/backend-review`) по изменениям в [`apps/paper-trading-service/src/paper-discovery/`](../apps/paper-trading-service/src/paper-discovery/): effective `paper.discovery`, кэш, fallback на env, отсутствие записи в чужие агрегаты.
- [x] Убедиться, что `CONFIG_SERVICE_URL` / `CONFIG_API_BASE` задокументированы в [`.env.example`](../.env.example).

## Frontend (`apps/web`)

- [x] Прогнать skill **frontend-review-agent** по [`settings-workspace.tsx`](../apps/web/components/settings-workspace.tsx): promote, PATCH status (activate draft), draft create/edit, `DestructiveOperatorAction`, инвалидация React Query (см. [`QUERY_INVALIDATION.md`](../apps/web/QUERY_INVALIDATION.md)).

## Architecture

- [x] При сомнениях по границе paper ↔ config: **architecture-guard-agent** (read-only конфиг, HTTP read-only в paper).

## Observability

- [x] Во всех Nest-приложениях в `apps/*` в `main.ts` вызывается `installMetricsOnFastify` с явным `serviceName` (проверено в репозитории: audit, canonical-market, capital, config, execution-orchestrator, market-intake, opportunity, paper-trading, portfolio, reconciliation, risk).

## Опционально (операционный зазор)

- [ ] Smoke outbox/bus: `docker compose -f infra/docker-compose.dev.yml --profile bus up -d`, затем из корня `npm run bus:publish` / `npm run bus:consume` при заданных `DATABASE_URL`, `KAFKA_BROKERS` — см. [`docs/TODO.md`](TODO.md) и [`docs/outbox-inbox.md`](outbox-inbox.md).
