# `@arbibot/openclaw-gateway`

OpenClaw **Operator API** gateway (Phase 5): JSON routes under `/openclaw/v1`, authenticated with `x-openclaw-api-key` (reads + approve-gated mutations).

OpenClaw is **not** a system of record; it proxies to domain services and the operator web BFF. See [`docs/openclaw-operator-boundaries.md`](../../docs/openclaw-operator-boundaries.md) and [`docs/openclaw-operator-api-spec.md`](../../docs/openclaw-operator-api-spec.md).

## Run locally

From repo root (with `.env` containing `OPENCLAW_API_KEYS` and upstream URLs):

```bash
npm run dev:openclaw
```

Default listen port: **3020** (`OPENCLAW_GATEWAY_PORT` / `PORT`).

## Environment

| Variable | Purpose |
|----------|---------|
| `OPENCLAW_API_KEYS` | Comma-separated accepted values for `x-openclaw-api-key` |
| `EXECUTION_API_BASE` | `execution-orchestrator` base (default `http://127.0.0.1:3012`) |
| `PORTFOLIO_API_BASE` | `portfolio-service` base (default `http://127.0.0.1:3016`) |
| `RECONCILIATION_API_BASE` | `reconciliation-service` base (default `http://127.0.0.1:3017`) |
| `OPERATOR_WEB_BFF_BASE` | Next.js `apps/web` base for `GET /api/operator/dashboard/summary` (default `http://127.0.0.1:3000`) |
| `AUDIT_API_BASE` | `audit-service` for `GET .../approvals-queue` → `/audit/entries` (default `http://127.0.0.1:3013`) |
| `OPENCLAW_MUTATION_RATE_LIMIT_MAX` | Max mutation requests per window per API key (default `60`) |
| `OPENCLAW_MUTATION_RATE_LIMIT_WINDOW_MS` | Rate limit window ms (default `60000`) |
| `OPENCLAW_MUTATION_RATE_LIMIT_ENABLED` | Set `false` to disable mutation rate limit |
| `METRICS_ENABLED` | Set `false` to disable Prometheus (default on) |

Correlation: incoming `x-correlation-id` is forwarded to upstream `fetch` calls when present (`@arbibot/nest-platform` pre-handler).

## Routes

| Method | Path | Upstream / behavior |
|--------|------|---------------------|
| GET | `/openclaw/v1/plans` | `GET {EXECUTION}/execution/plans` (+ optional `limit`, `cursor`) |
| GET | `/openclaw/v1/plans/:id` | `GET {EXECUTION}/execution/plans/:id` + `.../legs` |
| GET | `/openclaw/v1/positions` | `GET {PORTFOLIO}/positions` |
| GET | `/openclaw/v1/incidents` | `GET {RECONCILIATION}/mismatches` |
| GET | `/openclaw/v1/dashboard/summary` | `GET {OPERATOR_WEB_BFF}/api/operator/dashboard/summary` |
| GET | `/openclaw/v1/incident-briefs` | Reconciliation mismatches → short summaries |
| GET | `/openclaw/v1/approvals-queue` | `GET {AUDIT}/audit/entries?limit=` |
| GET | `/openclaw/v1/sessions` | Placeholder (empty items + note) |
| GET | `/openclaw/v1/safe-mode/status` | In-process safe mode flag |
| POST | `/openclaw/v1/plans/:id/arm` | `POST {EXECUTION}/execution/plans/:id/arm` + audit |
| POST | `/openclaw/v1/plans/:id/execute` | `POST {EXECUTION}/execution/plans/:id/begin-execution` + audit |
| POST | `/openclaw/v1/positions/:id/close` | Proxies to `portfolio-service` `POST /positions/:id/close` |
| POST | `/openclaw/v1/incidents/:id/resolve` | `PATCH {RECONCILIATION}/mismatches/:id` `{ status: resolved }` + audit |
| POST | `/openclaw/v1/safe-mode/enable` | In-process safe mode + audit |
| POST | `/openclaw/v1/safe-mode/disable` | In-process safe mode + audit |

Health (no API key):

- `GET /health`
- `GET /health/operator-bff` — probes `OPERATOR_WEB_BFF_BASE` when set

## curl examples

```bash
export KEY=dev-openclaw-key-change-me
curl -sS -H "x-openclaw-api-key: $KEY" http://127.0.0.1:3020/openclaw/v1/plans?limit=10
curl -sS -H "x-openclaw-api-key: $KEY" http://127.0.0.1:3020/openclaw/v1/plans/PLAN_UUID
curl -sS -H "x-openclaw-api-key: $KEY" http://127.0.0.1:3020/openclaw/v1/dashboard/summary
```

## `apps/web` BFF

Server-side proxy (no secret in the browser): `/api/operator/openclaw/v1/*` → gateway (`GET`, `POST`, `PATCH`). Set in **`apps/web`** env:

- `OPENCLAW_GATEWAY_URL`
- `OPENCLAW_BFF_API_KEY` (must match one of `OPENCLAW_API_KEYS` on the gateway)

`POST`/`PATCH` require an operator session; the BFF injects `operatorId` into the JSON body from the session when omitted.

See [`docs/openclaw-gateway-runbook.md`](../../docs/openclaw-gateway-runbook.md) for deployment and monitoring notes.
