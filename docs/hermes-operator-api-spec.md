# OpenClaw — Operator API (Phase 5)

**Status:** read + mutation routes implemented on **`openclaw-gateway`** (`P5-5-GW`, `P5-5-OAPI`, `P5-5-BRIEF` → `done`); UI (`P5-5-OCUI`) on `/openclaw`.  
**Principles:** OpenClaw is **not** SoT; reads/writes only through operator-approved surfaces ([`docs/openclaw-operator-boundaries.md`](openclaw-operator-boundaries.md)).

## Transport

- **Base path:** `/openclaw/v1` on **`openclaw-gateway`** (default port 3020).
- **Auth:** `x-openclaw-api-key` (server-to-server; comma-separated allowlist `OPENCLAW_API_KEYS`).
- **Correlation:** `x-correlation-id` on every request; forwarded upstream and into audit when present.

## Read models (GET)

| Endpoint | Description | Upstream |
|----------|-------------|----------|
| `GET /openclaw/v1/plans` | Execution plans list (cursor paginated) | `execution-orchestrator` |
| `GET /openclaw/v1/plans/:id` | Plan detail + legs summary | `execution-orchestrator` |
| `GET /openclaw/v1/positions` | Portfolio positions snapshot | `portfolio-service` |
| `GET /openclaw/v1/incidents` | Reconciliation mismatches / incidents | `reconciliation-service` |
| `GET /openclaw/v1/dashboard/summary` | Aggregated operator summary | `apps/web` BFF |
| `GET /openclaw/v1/incident-briefs` | Short summaries from mismatches | derived from reconciliation |
| `GET /openclaw/v1/approvals-queue` | Recent audit entries (`limit` query) | `audit-service` |
| `GET /openclaw/v1/sessions` | Placeholder (no registry yet) | — |
| `GET /openclaw/v1/safe-mode/status` | Safe mode flag | Redis when `REDIS_URL` / `OPENCLAW_SAFE_MODE_REDIS_URL` set, else in-process |

## Mutations (POST)

All mutations require JSON body with at least `{ "operatorId": "<id>" }` (BFF injects from operator session when omitted). Audit entries are written on success/failure HTTP path where applicable.

| Endpoint | Behavior |
|----------|----------|
| `POST /openclaw/v1/plans/:id/arm` | `POST {EXECUTION}/execution/plans/:id/arm` |
| `POST /openclaw/v1/plans/:id/execute` | `POST {EXECUTION}/execution/plans/:id/begin-execution` |
| `POST /openclaw/v1/positions/:id/close` | `POST {PORTFOLIO}/positions/:id/close` (quantity → 0; audit + optional idempotency) |
| `POST /openclaw/v1/incidents/:id/resolve` | `PATCH {RECONCILIATION}/mismatches/:id` with `status: resolved` (+ optional `expectedEntityVersion`) |
| `POST /openclaw/v1/safe-mode/enable` | Safe mode flag + audit (persisted in Redis when configured) |
| `POST /openclaw/v1/safe-mode/disable` | Safe mode flag + audit (persisted in Redis when configured) |

**Rate limiting:** mutation routes share a fixed-window limit per `x-openclaw-api-key` (see `OPENCLAW_MUTATION_RATE_LIMIT_*` in [`.env.example`](../.env.example)).

## RBAC matrix (draft)

| Route pattern | API key scope |
|---------------|---------------|
| `/openclaw/v1/plans*` | `read:execution` / `write:execution` for mutations |
| `/openclaw/v1/positions*` | `read:portfolio` |
| `/openclaw/v1/incidents*` | `read:reconciliation` / `write:reconciliation` for resolve |
| `/openclaw/v1/safe-mode/*` | `write:operator` |

## Changelog

- **2026-04-20:** Mutations, briefs, safe mode, approvals-queue, sessions placeholder; BFF `POST`/`PATCH` for `/api/operator/openclaw/v1/*`.
- **2026-04-20:** Read endpoints live; BFF proxy; see previous revisions for skeleton notes.
