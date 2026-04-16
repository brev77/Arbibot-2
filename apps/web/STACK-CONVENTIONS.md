# Operator web (`@arbibot/web`) — stack conventions

## Server state: TanStack Query

- **Browser lists and dashboards** load JSON through the **same-origin BFF** under `app/api/operator/**`, which proxies to Nest services using server env (`*_API_BASE` / `apiBases` in `lib/api-base.ts`). The browser must not hold upstream service URLs or secrets.
- Use **`fetchOperatorBffJson`** (`lib/operator-client-api.ts`) from client components and **`useQuery`** / **`useMutation`** with keys from **`operatorKeys`** (`lib/operator-query-keys.ts`).
- **`Providers`** (`app/providers.tsx`) wires **`createOperatorQueryClient()`** (`lib/query-client.ts`) so defaults (stale time, retries) are consistent.

### When to keep RSC

- **Detail routes** that need **`notFound()`**, heavy server-only parsing, or one-shot SSR without refetch can stay **Server Components** with `fetch` / `fetchJson` to the BFF or internal URLs.
- **Lists** that benefit from **refresh**, **focus refetch**, or shared cache across tabs should use **client workspaces** + Query.

## UI: shadcn-style primitives

- New shared controls live under **`components/ui/*`**, built like [shadcn/ui](https://ui.shadcn.com/) (Radix + **`cva`** + **`cn()`** from `lib/cn.ts`).
- Prefer **`Button`** (and future `Input`, `Dialog`, …) for new surfaces; legacy inline styles in nav/layout may remain until migrated.
- **Tailwind** is enabled in `app/globals.css` (`@tailwind` layers). Theme continues to use **`html.theme-light`** (see `ThemeToggle`); Tailwind `darkMode: ['class']` is reserved for future alignment with shadcn defaults.

## Types and API shapes

- Reuse DTO-aligned types from `lib/*-types.ts` and `ListResponse` from `lib/server-api.ts` for BFF JSON.

## Paper vs live (продуктовый канон)

По плану первичного запуска оператор **сначала** валидирует систему в **paper** (`/paper`, фильтры Environment); live — следующий шаг с минимальным капиталом. Реализация `/paper` и BFF должны явно разделять источники данных paper и live (см. корневой `!Arbibot_2_Frontend_Spec_settings.md`, `.cursor/plans/DEVELOPMENT_PLAN.md`).
