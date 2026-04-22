# 04 — Тестирование и CI

Истина по командам — корневой [package.json](../../package.json); оркестрация PR — [.github/workflows/ci.yml](../../.github/workflows/ci.yml). Чеклист ручной верификации CI — [docs/ci-verification-checklist.md](../ci-verification-checklist.md). Сценарии E2E с точки зрения продукта — [docs/e2e-scenarios.md](../e2e-scenarios.md).

## Базовые команды

| Команда | Назначение |
|---------|------------|
| `npm run test` | Юнит/интеграционные тесты по workspace (Turbo). |
| `npm run lint` | ESLint по монорепо. |
| `npm run build` | Сборка всех пакетов. |

## E2E и CI-обёртки (карта)

| Скрипт | Предпосылки (кратко) | Что проверяет |
|--------|----------------------|----------------|
| `e2e:phase1-foundation` | Миграции, подняты intake, opportunity, risk, capital, execution | Цепочка Phase 1 до arm; опционально нога исполнения (`E2E_INCLUDE_EXECUTION_LEG=true`). Скрипт: `tools/e2e-phase1-foundation-chain.mjs`. |
| `e2e:phase2-controlled-execution` | Как Phase 1 + venue (mock или HTTP) | Полный контур ног до `plan.completed`. `tools/e2e-phase2-controlled-execution.mjs`. |
| `ci:e2e-phase2` | Postgres, lab venue, собранные Nest-приложения | CI job `e2e-phase2`. `tools/ci-e2e-phase2.sh`. |
| `e2e:phase2-watchlist-route-scoring` | БД, risk-service, токен job trigger | Writers watchlist / route scoring. `tools/e2e-phase2-watchlist-route-scoring.mjs`. |
| `ci:e2e-phase2-watchlist-route-scoring` | Postgres + risk | CI job одноимённый. |
| `e2e:phase3-paper-promotion` | Миграции ≥ нужных для paper, opportunity + paper, `PAPER_TRADING_SERVICE_URL` | Paper enqueue, relay, approve кандидата, trades. `tools/e2e-phase3-paper-promotion.mjs`. |
| `ci:e2e-phase3` | Postgres + paper + opportunity | `tools/ci-e2e-phase3-paper-promotion.sh`. |
| `ci:e2e-phase3-paper-discovery` | Postgres + paper + market-intake | Discovery pipeline. `tools/ci-e2e-phase3-paper-discovery.sh`, `tools/e2e-p3-paper-discovery.mjs`. |
| `e2e:phase4-tier-routing` | risk, config, market-intake, флаг throttling | Tier routing и throttle intake. `tools/e2e-phase4-tier-routing.mjs`. |
| `ci:e2e-phase4-tier-routing` | Postgres + три сервиса | CI job одноимённый. |
| `ci:bus-smoke` | Сборка bridge, опционально Docker `bus` | Kafka bridge и smoke consumer. `tools/ci-bus-smoke.sh`. |

Проверка применённых миграций: `npm run db:verify-migrations` / `db:verify-migrations:all`.

Операторская эксплуатация: [05 — оператор и runbooks](05-operator-runbooks.md).
