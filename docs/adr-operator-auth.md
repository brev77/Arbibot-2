# ADR: Operator authentication for `apps/web`

**Status:** accepted — target for `D4-A-1-AUTH` (paper-deploy, Phase A)  
**Date:** 2026-07-12  
**Supersedes:** implicit «unsigned `arbibot_role` cookie» model (finding **P1** in [`docs/deployment-readiness-review-2026-07.md`](deployment-readiness-review-2026-07.md))  
**Plan step:** [`D4-A-0-ADR`](../.cursor/plans/deploy-readiness/D4-A-0-ADR.md) → [`D4-A-1-AUTH`](../.cursor/plans/deploy-readiness/D4-A-1-AUTH.md)

## Context

`apps/web/middleware.ts:12` and `apps/web/lib/operator-session.ts:30` read the operator role from an **unsigned** `arbibot_role` cookie (viewer / operator / admin). There is no JWT, login, session-store, or IdP (`jsonwebtoken`, `iron-session`, `next-auth`, `jose` — grep empty). `ARBIBOT_DEV_ROLE` is correctly disabled in production (`NODE_ENV !== 'production'` guard, F4 closed), and `tools/validate-env.sh` blocks it in prod `.env`. **But the cookie itself is a bearer token with no issuance or verification** — anyone who sets `arbibot_role=admin` (XSS, misconfigured reverse proxy, shared machine) becomes admin. Today the only protection is network access (nginx). For any non-localhost placement this is unacceptable, and it blocks paper-deploy on an isolated host (P1).

The auth model must satisfy:

- **C1.** Works on an isolated paper-deploy host with **no external IdP** (paper-first principle).
- **C2.** Compatible with the existing role model in [`apps/web/lib/operator-role.ts`](../apps/web/lib/operator-role.ts) (`viewer` / `operator` / `admin`).
- **C3.** Verifiable in **both** Edge middleware (`apps/web/middleware.ts`) and RSC / BFF routes (`apps/web/lib/operator-session.ts`, `apps/web/app/api/operator/**`).
- **C4.** No regression for local dev (`ARBIBOT_DEV_ROLE` path preserved when `NODE_ENV !== 'production'`).
- **C5.** Clear extension path to live (multi-operator, external IdP) without re-architecting the session shape.

## Decision

**Option 1 — HTTP-only signed JWT cookie (HMAC via `jose`), issued by the server after a verification step.**

### Session shape

- Cookie **`arbibot_session`** (replaces `arbibot_role` as the source of truth): a compact JWS (HS256) with claims:
  - `sub` — stable operator identity (forwarded as `operatorId` to backends / audit)
  - `role` — one of `viewer` / `operator` / `admin`
  - `iat`, `exp` — issued-at / expiry; **8h** lifetime (operator shift)
  - `jti` — unique session id (for future revocation list)
- Cookie attributes: `httpOnly: true`, `secure: true` (prod), `sameSite: 'lax'`, `path: '/'`.
- Signing secret: **`OPERATOR_SESSION_SECRET`** (32+ bytes, base64), required in prod (fail-fast if missing, like `PRIVATE_KEY_ENCRYPTION_KEY`).
- Algorithm: **HS256** for paper-deploy (single-tenant, single signer). Extension to **RS256 / ES256 + JWKS** deferred to live when an external IdP signs tokens.

### Verification (middleware + RSC)

- `apps/web/middleware.ts` (Edge): verify `arbibot_session` via `jose.jwtVerify(cookie, secret)`; on failure / missing → existing redirect / 401 flow. Role is read from the verified claim, **not** from `arbibot_role`.
- `apps/web/lib/operator-session.ts` (RSC): same `jwtVerify`; `ARBIBOT_DEV_ROLE` remains a dev-only fallback (`NODE_ENV !== 'production'`).
- `apps/web/lib/operator-role.ts` (`normalizeRole` / `roleMeetsMinimum` / `minimumRoleForPathname`) — **unchanged**; they already operate on the role string, so the source switch is transparent.
- The plaintext `arbibot_role` cookie is **removed** from the auth path (kept only as a non-trusted UI hint if desired; never read for authorization).

### Issuance (bootstrap for paper-deploy, no external IdP)

- `POST /api/auth/session` issues a signed `arbibot_session` after verifying a bootstrap credential:
  - Paper-deploy default: **`OPERATOR_BOOTSTRAP_TOKEN`** (env, single shared secret for the small paper-deploy operator team) — request body carries the token + requested role (clamped to `admin` max for paper).
  - This is intentionally minimal: paper-deploy runs on an isolated host behind nginx TLS; the bootstrap token is rotated per deploy and not a long-term credential.
- `POST /api/auth/session/revoke` clears the cookie (logout).
- No password store, no user table for paper — by design (C1).

### Extension path to live (Option 3 convergence)

- For live / multi-operator: introduce an external IdP (Keycloak / Authelia / corporate OIDC) in front of nginx; nginx forwards a trusted header (e.g. `X-Operator-Claims`), and `apps/web` reads the header **only** when `NODE_ENV === 'production' && TRUSTED_AUTH_HEADER` is set — otherwise it falls back to verifying `arbibot_session` itself.
- Migrating HS256 → RS256/ES256 + JWKS at that point is a key-rotation, not a session-shape change; `sub` / `role` claims stay identical, so `operator-role.ts` and all BFF consumers are untouched (C5).

## Alternatives considered

| Option | Rejection reason (for paper-deploy) |
|--------|-------------------------------------|
| **2. NextAuth / Auth.js** (Credentials or OIDC + signed cookie) | Adds a dependency and session provider abstraction for a single-tenant paper host with a handful of operators. Credentials provider has known JWT-encryption caveats; OIDC requires an external IdP, which C1 rules out for paper. Revisit for live if a multi-provider model is needed. |
| **3. External IdP (Keycloak/Authelia) + nginx trusted header** | Strongest end state for live, but **requires an external IdP** — fails C1 for paper-deploy on an isolated host. Adopted as the **live extension path** above, not the paper-deploy default. |

## Consequences

- **New work (D4-A-1-AUTH):** add `jose` to `apps/web`; implement `verifyOperatorSession` (shared by middleware + RSC); `POST /api/auth/session` (issue) + revoke; remove `arbibot_role` from the auth path; add `OPERATOR_SESSION_SECRET` + `OPERATOR_BOOTSTRAP_TOKEN` to `.env.production.example` and `tools/validate-env.sh`.
- **Dev experience:** `ARBIBOT_DEV_ROLE` path preserved (C4); no login screen required locally.
- **Security:** bearer-cookie problem closed — a forged `arbibot_role=admin` no longer grants admin. Secret rotation = `OPERATOR_SESSION_SECRET` swap + cookie re-issuance.
- **Audit:** `sub` claim gives a stable, server-verified `operatorId` for config-service / audit trails (replaces the unsigned `arbibot_operator_id` cookie).
- **Non-goal for paper:** no refresh tokens, no revocation list, no MFA — paper-deploy is single-host, small team, 8h sessions. All three are live-gate concerns (deferred).

## Implementation notes

- Code (in `D4-A-1-AUTH`, not this step): `apps/web/lib/operator-session-jwt.ts` (verify), `apps/web/app/api/auth/session/route.ts` (issue / revoke), wiring in `middleware.ts` + `operator-session.ts`.
- Env: `OPERATOR_SESSION_SECRET`, `OPERATOR_BOOTSTRAP_TOKEN`, optional `OPERATOR_SESSION_TTL_SECONDS` (default 28800 = 8h).
- Tests: unit tests for sign/verify round-trip, expired-token rejection, role-tamper rejection, dev fallback; middleware spec for 401/redirect on missing/invalid session.

## Links

- Source review: [`docs/deployment-readiness-review-2026-07.md`](deployment-readiness-review-2026-07.md) §4 P1
- Role model: [`apps/web/lib/operator-role.ts`](../apps/web/lib/operator-role.ts)
- Current (to be replaced) session: [`apps/web/lib/operator-session.ts`](../apps/web/lib/operator-session.ts), [`apps/web/middleware.ts`](../apps/web/middleware.ts)
- Plan: [`.cursor/plans/DEVELOPMENT_PLAN4.md`](../.cursor/plans/DEVELOPMENT_PLAN4.md) — Фаза A
