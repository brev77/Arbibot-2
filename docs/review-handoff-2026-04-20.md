# Review handoff — production sprint (2026-04-20)

Formal **review_passed** record for steps closed in the short-term production plan (local CI parity + hygiene).

## Checks performed

| Check | Result |
|--------|--------|
| `npm run lint` (Turbo, all workspaces) | Pass (after fixes: `partial-fill-playbook` assertions; stray `src/**/*.d.ts` removed from `apps/config-service`; eslint `--ignore-pattern` for `.d.ts`) |
| `npm run build` | Pass |
| `npm run test` | Pass |

## Architecture / boundaries (spot)

- **Outbox → Kafka:** bridge allowlist unchanged; `seed-outbox-events.mjs` aligns envelope shapes with `@arbibot/contracts` event names for smoke rows.
- **HTTP venue:** `VenueSubmitClientError` carries optional `meta` (`httpStatus`, `category`, `venueErrorCode`) for 4xx taxonomy; no change to retry invariants (transient vs client).
- **Settings BFF:** `GET .../configurations/:key/effective` is read-only proxy to config-service (operator session required).

## Steps advanced in `DEVELOPMENT_PLAN.md`

- `PRIO-P2-PROMO` → **`done`** (was `implemented`)
- `PRIO-P2-RECAL` → **`done`** (was `implemented`)

## Follow-up (not blocking)

- Run `npm run db:verify-migrations` on each environment after `npm run db:migrate`.
- GitHub Actions: confirm all jobs green on `main` after push.
- Multi-instance: apply Redis env for `openclaw-gateway` per [`docs/openclaw-safe-mode-runbook.md`](openclaw-safe-mode-runbook.md).
