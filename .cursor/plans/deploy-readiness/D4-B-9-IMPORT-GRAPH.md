# D4-B-9-IMPORT-GRAPH — CI enforcement paper/live import-graph boundary

| Поле | Значение |
|------|----------|
| **depends_on** | — |
| **risk_level** | `low` |
| **estimated_hours** | 2 |
| **status** | `done` |

## Контекст (из ревью)
`.cursor/skills/dex-security-and-capital-safety/references/paper-live-boundary.md` определяет import-контракт (PL.1): `paper-trading-service` не должен импортить live-service модули (`@arbibot/capital-service`, execution-orchestrator wallet modules, `WalletManagerService`, `KeyVaultService`, `getEncryptedKey`). Сегодня чисто (grep пустой), но **нет CI-gate** — регрессия поймается только если ревьюер вспомнит запустить skill. Угроза **C3 (🔴)** (medium-high).

## Outputs
- `tools/ci-paper-live-boundary.sh` — скрипт:
  - В `apps/paper-trading-service/src/` grep запрещённых импортов:
    - `@arbibot/capital-service`
    - `execution-orchestrator.*wallet` / `WalletManagerService`
    - `KeyVaultService` / `getEncryptedKey` / `decryptPrivateKey`
  - В `apps/execution-orchestrator/src/` (live path) — grep paper-only модулей (обратное загрязнение)
  - Exit 1 при нарушении
- `package.json` — `ci:paper-live-boundary` скрипт
- `.github/workflows/ci.yml` — новый джоб `paper-live-boundary` (blocking: `continue-on-error: false`), runs after checkout (no npm ci needed, pure grep)
- Документировать allowlist исключений (если появятся легитимные shared types — через `@arbibot/contracts`, не прямые импорты)

## Acceptance
- [x] `tools/ci-paper-live-boundary.sh` exits 0 на текущем коде
- [x] При добавлении запрещённого импорта в paper-trading-service → exits 1 (negative test verified: PL1-capital, PL1-execution, PL1-wallet all fire)
- [x] CI-джоб blocking (нет `continue-on-error`, дефолт = blocking)
- [x] Allowlist задокументирован: shared types через `@arbibot/contracts` разрешены (не в списке запрещённых); `.spec.ts`/`.mock.ts`/`__mocks__`/`*.d.ts` исключены

## Implementation notes
- `tools/ci-paper-live-boundary.sh` — new guard, mirrors `ci-key-leakage.sh` structure (production-only TS, exclude specs/mocks/d.ts, trap-cleanup).
- Scans **import statements** only (`^[[:space:]]*(import|export ... from|} from).*<pattern>`) — bare mentions in comments/strings are not flagged (PL.3 carve-out).
- Rules:
  - **PL1-paper-imports-capital** — `@arbibot/capital-service`
  - **PL1-paper-imports-execution** — `@arbibot/execution-orchestrator`
  - **PL1-paper-imports-wallet** — `WalletManagerService|KeyVaultService|getEncryptedKey|decryptPrivateKey`
  - **PL2-exec-imports-paper** — `@arbibot/paper-trading-service|PaperCapitalService|PaperTradeService|paper-enqueue` (reverse contamination)
  - **PL2-capital-imports-paper** — `@arbibot/paper-trading-service|PaperCapitalReservation|PaperCapitalService`
- `package.json`: added `ci:paper-live-boundary` script.
- `.github/workflows/ci.yml`: new job `paper-live-boundary` (after `secret-scan`, no `npm ci`, blocking).

## Edge Cases
- Shared types через `@arbibot/contracts` — **разрешено** (это и есть правильный boundary)
- Test-файлы (`.spec.ts`) — exempt (моки допустимы)
- False positive на строку-комментарий → grep по `import` statements, не bare mentions

## Test Commands
```bash
npm run ci:paper-live-boundary   # локально, exit 0
# Негативный тест: временно добавить запрещённый импорт → exit 1
```

## Rollback
`git checkout -- .github/workflows/ci.yml package.json` + `rm tools/ci-paper-live-boundary.sh`
