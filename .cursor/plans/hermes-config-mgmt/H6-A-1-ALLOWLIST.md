# H6-A-1-ALLOWLIST — config-allowlist.ts

| Поле | Значение |
|------|----------|
| **depends_on** | `H6-A-0-ADR` |
| **risk_level** | `high` (enforcement точка) |
| **status** | done |

## Outputs
- `apps/hermes-gateway/src/hermes/config-allowlist.ts`.

## Содержание
- `ALLOWED_CONFIG_KEY_PATTERNS`: `^intake\.`, `^paper\.`, `^opportunity\.`, `^dex\.`, `^features\.`.
- `BLOCKED_CONFIG_KEY_PATTERNS`: `^risk\.`, `^execution\.`, `^capital\.`.
- `assertConfigKeyAllowed(key)` → `ForbiddenException` (403) с русским сообщением для sensitive/незапрещённых.

## Test
Покрыто в `hermes-config.service.spec.ts`: risk/execution/capital → ForbiddenException, dex/intake/paper/features → пропущены.
