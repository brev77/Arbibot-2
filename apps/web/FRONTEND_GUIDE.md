# Инструкция по фронтенду оператора (`@arbibot/web`)

Next.js 16 (App Router), React 19, TanStack Query, TanStack Table, Tailwind, Zustand. Браузер ходит только в **same-origin BFF** `app/api/operator/**`; апстримы Nest задаются **серверными** переменными `*_API_BASE` (см. [`lib/api-base.ts`](lib/api-base.ts) и корневой [`.env.example`](../../.env.example)).

Детальные конвенции по данным и UI: [`STACK-CONVENTIONS.md`](STACK-CONVENTIONS.md). Инвалидация кэша запросов: [`QUERY_INVALIDATION.md`](QUERY_INVALIDATION.md).

---

## Требования и запуск

- **Node.js** ≥ 22, **npm** как в корневом `packageManager`.
- Из **корня монорепозитория**:
  - `npm ci` (при первой настройке)
  - скопировать [`.env.example`](../../.env.example) → `.env`, выставить URL сервисов (для BFF нужны `RISK_API_BASE`, `OPPORTUNITY_API_BASE`, … — см. комментарии в `.env.example`)
- Только веб в dev (порт по умолчанию **3000**; если занят **risk-service**, задайте другой, например `3005`):

  ```bash
  npm run dev -w @arbibot/web -- --port 3005
  ```

- Линт / production-сборка:

  ```bash
  npm run lint -w @arbibot/web
  npm run build -w @arbibot/web
  ```

Страницы оператора ожидают доступные по `*_API_BASE` бэкенды; иначе BFF вернёт ошибки прокси — это нормально для «только UI».

---

## Структура каталогов (важное)

| Путь | Назначение |
|------|------------|
| [`app/(operator)/`](app/(operator)/) | Маршруты дашборда: `dashboard`, `paper`, `settings`, … |
| [`app/api/operator/`](app/api/operator/) | BFF Route Handlers — прокси + проверки, без секретов в клиенте |
| [`components/`](components/) | Общие компоненты страниц, таблиц, layout, `DestructiveOperatorAction`, … |
| [`components/ui/`](components/ui/) | Примитивы в стиле shadcn (Radix + `cva` + `cn`) |
| [`lib/`](lib/) | `api-base`, `operator-client-api`, `operator-query-keys`, `query-client`, типы, роли |

---

## Данные: BFF + TanStack Query

1. **Клиент** не вызывает Nest напрямую. Используйте [`fetchOperatorBffJson`](lib/operator-client-api.ts) с путём вида `/paper/trades` (префикс `/api/operator` добавляется внутри).
2. Ключи запросов — [`operatorKeys`](lib/operator-query-keys.ts); провайдер — [`app/providers.tsx`](app/providers.tsx) + [`createOperatorQueryClient`](lib/query-client.ts).
3. Списки и дашборды — **client components** + `useQuery` / `useMutation`; тяжёлый one-shot SSR или `notFound()` — по необходимости RSC (см. [`STACK-CONVENTIONS.md`](STACK-CONVENTIONS.md)).
4. После мутаций — `invalidateQueries` по стратегии из [`QUERY_INVALIDATION.md`](QUERY_INVALIDATION.md).

### Обзор BFF-маршрутов

- Дашборд: `GET /api/operator/dashboard/summary`
- Возможности, исполнение, портфель, сверка, аудит — см. дерево [`app/api/operator/`](app/api/operator/)
- Paper: trades, promotion-candidates, drift-samples + мутации в `[id]/route.ts`
- Настройки (config-service): configurations, effective, history, rollback, promote, status; read-only watchlist-tiers и route-scoring
- Phase 4: `GET /api/operator/health/degradation` → market-intake
- OpenClaw: `app/api/operator/openclaw/v1/[[...path]]/route.ts` — прокси на gateway (методы и требования сессии см. в коде маршрута)

---

## RBAC и сессия оператора

[`middleware.ts`](middleware.ts) ограничивает страницы под `(operator)` и все запросы к `/api/operator/*`.

- Роль: cookie **`arbibot_role`** = `viewer` | `operator` | `admin`, либо **`ARBIBOT_DEV_ROLE`** в env, либо в **не-production** без настроек — по умолчанию **`operator`**.
- Минимальные роли по путям заданы в [`lib/operator-role.ts`](lib/operator-role.ts): например `/dashboard` и `/opportunities` — **viewer**; `/paper`, `/execution`, … — **operator**; **`/settings`** и **`/openclaw`** — **admin**.
- BFF при отсутствии сессии отвечает **401** (`OPERATOR_SESSION_REQUIRED`), при недостаточной роли — **403** (`OPERATOR_INSUFFICIENT_ROLE`).

---

## UI и таблицы

- Новые контролы — через примитивы в [`components/ui/`](components/ui/), утилита классов [`lib/cn.ts`](lib/cn.ts).
- Таблицы — TanStack Table; тема: `html.theme-light` и Tailwind в [`app/globals.css`](app/globals.css).
- Опасные действия оператора — паттерн **`DestructiveOperatorAction`** (см. [`components/README-APPROVAL-FLOW.md`](components/README-APPROVAL-FLOW.md)).

---

## Маршруты UI (карта)

Основные страницы: `/`, `/dashboard`, `/opportunities`, `/execution`, `/portfolio`, `/tokens`, `/paper`, `/incidents`, `/runbooks`, `/settings`, `/openclaw`. Точное соответствие файлам — каталог [`app/(operator)/`](app/(operator)/).

Продуктовый канон **paper-first**: оператор сначала валидирует контур в paper; см. корневой план и [`STACK-CONVENTIONS.md`](STACK-CONVENTIONS.md).

---

## Отладка и типичные проблемы

- **502 / ошибки BFF** — проверьте, что целевой сервис запущен и совпадает с `*_API_BASE` в `.env`.
- **Редирект на `/` с `forbidden=1`** — роль из cookie/env не проходит `minimumRoleForPathname`.
- **Порт 3000 занят** — поднимайте Next с `--port`, как в разделе «Запуск».
- Репозиторий в пути **с пробелом** может мешать `nest build` у других пакетов; для полного стека см. workaround в корневом [`AGENTS.md`](../../AGENTS.md).

---

## Связанные документы в репозитории

- [`STACK-CONVENTIONS.md`](STACK-CONVENTIONS.md) — RSC vs Query, BFF, shadcn
- [`QUERY_INVALIDATION.md`](QUERY_INVALIDATION.md) — инвалидация после мутаций
- [`components/README-APPROVAL-FLOW.md`](components/README-APPROVAL-FLOW.md) — согласование опасных действий
- Корневой [`README.md`](../../README.md) — порты сервисов и скрипты монорепо
- Спеки UI в корне: `!Arbibot_2_Frontend_Spec_settings.md` (если есть в checkout)
