# ADR: Structured logging (nestjs-pino) + release versioning

**Status:** accepted — target for `D4-C-1` (logging) + `D4-C-2` (versioning) of Plan 4 Фаза C
**Date:** 2026-07-16
**Supersedes:** «plain-text logs + SHA-only image tags» state for P4/P5 from [`docs/deployment-readiness-review-2026-07.md`](deployment-readiness-review-2026-07.md) §4
**Plan step:** [`D4-C-0-DAY2-ADR`](../.cursor/plans/deploy-readiness/D4-C-0-DAY2-ADR.md) → `D4-C-1-LOGGING`, `D4-C-2-VERSIONING`

## Context

The deployment-readiness review (2026-07) found two day-2 operational gaps (P4, P5):

- **P4 — No structured logging.** All services use NestJS `Logger` (plain text). `packages/nest-platform/src/structured-logger.ts` only prepends `[correlationId=...]` to a text message — **0 application callers** today (dead code). The Loki + Promtail stack is deployed, and `infra/promtail/promtail-config.yaml` already has a `json` pipeline stage — but it silently no-ops on the current plain-text output, so log fields are not queryable as labels.
- **P5 — No release versioning.** No `CHANGELOG.md`, no git tags (`git tag` is empty), no `version` field in root `package.json`. Container images are tagged only by git SHA + `latest`. Rollback to «the previous release» requires finding the previous SHA manually; there is no release history an operator can read.

**Canonical principle:** day-2 operability — structured logs queryable in Loki, and explicit semver-tagged releases traceable in git + GHCR — must exist **before** live capital, because incident response and rollback are the two most common day-2 actions.

## Current-state inventory (verified 2026-07-16)

| # | Gap | Current state | file:line |
|---|-----|---------------|-----------|
| P4 | No structured logging | Plain-text `Logger`; `withCorrelation()` has 0 callers; Promtail `json` stage no-ops on text output | `packages/nest-platform/src/structured-logger.ts:8`; `infra/promtail/promtail-config.yaml:31-42`; ~104 `this.logger.log(` call sites across `apps/` |
| P5 | No versioning | No `CHANGELOG.md`; `git tag` empty; no `version` in root `package.json`; cd.yml tags `latest` + SHA only | `.github/workflows/cd.yml:91-99`; `docs/deployment-guide.md:730-748` (rollback by manual SHA lookup) |

## Decision

### 1. Logging (P4) — `D4-C-1-LOGGING`

- **Library:** **`pino` directly** (already present as a fastify transitive; added as an explicit `@arbibot/nest-platform` dependency for stability), wrapped in a small in-repo `PinoLoggerService` that implements Nest's `LoggerService`. Alternatives rejected:
  - `nestjs-pino` — pulls `pino-http` as a peer and adds a module + HTTP middleware configuration per service; for paper-phase the extra surface area is not justified. The in-repo wrapper is ~100 lines, auditable, and reads the **existing** ALS correlation id without new middleware.
  - `winston` — heavier, less idiomatic Nest integration, double-wrapping with Nest `LoggerService`.
- **Output format (one JSON object per line):**
  ```json
  {"level":"info","time":1721139600000,"service":"risk-service","correlationId":"...","context":"RiskService","msg":"...","meta":{...}}
  ```
  - `time` — epoch millis (pino default; Promtail `json` stage reads it as `time`).
  - `level` — pino numeric level mapped to string label (`info`/`warn`/`error`/...) at the pino-pretty boundary for dev; production emits pino's default `level:30` style OR stringified — **decided: stringified labels** (`info`/`warn`/`error`) for direct Loki label use without a Promtail `template` stage.
  - `service` — set per-app from `main.ts` (same value as `installMetricsOnFastify({ serviceName })`).
  - `correlationId` — inherited from the existing ALS (`getCorrelationId()`); `nestjs-pino`'s request-scoped child logger picks it up via a custom logger factory, not a new middleware.
  - `context` — Nest class name (pino `mixin`/`context` mapping).
- **Correlation propagation:** reuses the **existing** `correlationIdPreHandler` (`packages/nest-platform/src/correlation.ts:20-33`) and ALS — **no new middleware**. The pino logger reads `getCorrelationId()` at emit time so every log line in a request inherits the request's correlation id.
- **Nest `Logger` override:** `app.useLogger(new PinoLoggerService({ serviceName }))` in every service `main.ts`, via a shared helper `configureArbibotLogger(app, serviceName)` exported from `@arbibot/nest-platform` (one-line change per service, identical across all 12). All ~104 existing `this.logger.log(...)` call sites keep working unchanged — the new `LoggerService` implements the same API. This minimises churn (the ADR's decision criterion).
- **Sensitive-field redaction (K1.1 — extends `ci-key-leakage` K1):** pino `redact` config in `packages/nest-platform/src/logging/redact.config.ts`:
  - `*.privateKey`, `*.mnemonic`, `*.signingKey`, `*.decryptedKey`, `*.rawKey`
  - `*.secret`, `*.apiKey`, `*.authorization`, `req.headers.authorization`, `req.headers["x-hermes-api-key"]`
  - Redaction is **at the serializer**, not just logging sites — any object passed to the logger with these paths has the value replaced with `[Redacted]` before serialisation.
- **Log level by env:** `LOG_LEVEL=debug|info|warn|error` (default `info`); parsed once at logger construction.
- **Promtail alignment:** verify `infra/promtail/promtail-config.yaml` `json` stage field names match pino output (`level`, `msg`, `time`); add `labels.service` from the parsed `service` field so Loki queries can filter `{service="risk-service"}`. Align Promtail version dev↔prod (`infra/docker-compose.dev.yml:150` 3.2.1 → `infra/docker-compose.prod.yml:486` 3.3.2 — pin both to the **prod** version 3.3.2 to remove drift).
- **Performance budget:** pino is async + binary JSON; target `<5%` added latency per request vs the current plain-text logger (measured on a dev load-test with `npm run venue:load-test`). If exceeded, reduce redact paths or move to pino `sync: false`.
- **Bootstrap logs (before pino init):** pino buffers and flushes after `app.useLogger` — acceptable; bootstrap failures are rare and also surface as process exit.

### 2. Versioning (P5) — `D4-C-2-VERSIONING`

- **Format:** **manual** Keep-a-Changelog `CHANGELOG.md` + git tags `v<major>.<minor>.<patch>-<phase>`. No `standard-version` / `semantic-release` automation — paper-phase does not justify the tooling overhead; manual is auditable and cheap.
  - Phase suffix carries the lifecycle stage: `v0.1.0-paper` (paper-deploy baseline), `v0.2.0-live` (first live release). After 1.0 the suffix drops.
- **`package.json` root:** add `"version": "0.1.0"` (pre-1.0, paper-phase). `"private": true` stays (not published to npm).
- **Git tags:** first tag `v0.1.0-paper` on the post-D4-C-2 commit establishes the paper-deploy baseline. Tags are **outward-facing** (pushed to remote) — tagging happens only with product-owner awareness.
- **`docs/release-process.md`:** the procedure an operator follows to cut a release:
  1. Update `CHANGELOG.md` (manual entries under `## [Unreleased]`, then promote to a version header).
  2. Bump `version` in root `package.json`.
  3. `git tag v<X.Y.Z>-<phase>` + `git push --tags`.
  4. cd.yml on tag-push additionally tags the GHCR images with the semver tag (via `docker/metadata-action` `type=ref,event=tag`).
  5. Rollback: `IMAGE_TAG=v<prev> docker compose -f infra/docker-compose.prod.yml up -d` (documented in `docs/deployment-guide.md` §11).
- **cd.yml change:** add `type=ref,event=tag` to the existing `docker/metadata-action@v5` tag rules so a `v0.1.0-paper` tag produces an image tagged `v0.1.0-paper` **in addition to** the SHA and `latest` tags.
- **Pre-1.0 instability:** documented in `release-process.md` — minors may be breaking until 1.0; operators read the CHANGELOG `Changed`/`Removed` sections before bumping.

## Consequences

- **Positive:** Loki queries become field-based (`{service="execution-orchestrator",level="error"} |= "bridge"`); releases become traceable (`git tag`, GHCR semver); rollback has a concrete target (`v<prev>`).
- **Negative:** every service `main.ts` gets a one-line logger change (12 files); Promtail config + version pin touched; one new dependency (`nestjs-pino`, `pino`). Acceptable — churn is mechanical and the ADR's decision criterion (preserve `withCorrelation()` API, no rewrite of call sites) holds.
- **Risk:** redact paths must stay in sync with new sensitive fields; `ci-key-leakage` (D4-B-7) catches literal leaks, the redact config catches object-property leaks — defence in depth.

## Alternatives considered

- **winston** for logging — rejected (heavier, less idiomatic Nest).
- **semantic-release** for versioning — rejected (automation overhead unjustified pre-1.0; manual changelog is more legible to operators).
- **OpenTelemetry logs SDK** as the structured logger — rejected (not yet stable for logs; pino is the pragmatic choice now; OTLP traces already in place via `startOpenTelemetryNodeSdkIfConfigured`).

## References

- Review source: [`docs/deployment-readiness-review-2026-07.md`](deployment-readiness-review-2026-07.md) §4 (P4/P5)
- Plan steps: [`D4-C-0-DAY2-ADR`](../.cursor/plans/deploy-readiness/D4-C-0-DAY2-ADR.md), [`D4-C-1-LOGGING`](../.cursor/plans/deploy-readiness/D4-C-1-LOGGING.md), [`D4-C-2-VERSIONING`](../.cursor/plans/deploy-readiness/D4-C-2-VERSIONING.md)
- Companion: `docs/observability-tracing.md` (Loki query examples added in D4-C-1), `docs/deployment-guide.md` §11 (rollback by semver tag added in D4-C-2)
