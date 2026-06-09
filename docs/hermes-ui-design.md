# OpenClaw UI (`/openclaw`) — design notes

## Layout

Implemented in [`apps/web/components/openclaw/openclaw-workspace.tsx`](../apps/web/components/openclaw/openclaw-workspace.tsx) (client component).

Sections:

1. **Safe mode** — enable/disable via `POST /openclaw/v1/safe-mode/enable|disable` (audited); status from `GET /openclaw/v1/safe-mode/status`.
2. **Dashboard summary** — read-through BFF to gateway `GET /openclaw/v1/dashboard/summary`.
3. **Execution plans** — table with **Arm** / **Begin execution** actions behind [`DestructiveOperatorAction`](../apps/web/components/destructive-operator-action.tsx) (typed confirmation).
4. **Incident briefs** — `GET /openclaw/v1/incident-briefs` (reconciliation-derived summaries).
5. **Approvals queue** — tail of `GET /openclaw/v1/approvals-queue` (audit `GET /audit/entries` via gateway); informational, not a workflow engine.
6. **Sessions** — placeholder from `GET /openclaw/v1/sessions` until a session registry exists.

## Global banner

When safe mode is on, [`apps/web/components/safe-mode-banner.tsx`](../apps/web/components/safe-mode-banner.tsx) renders below the degraded banner in the operator layout.

## Query keys

See [`apps/web/lib/operator-query-keys.ts`](../apps/web/lib/operator-query-keys.ts) — `openclaw*` keys for React Query cache boundaries.
