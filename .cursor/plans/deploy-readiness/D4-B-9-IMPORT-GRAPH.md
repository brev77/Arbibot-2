# D4-B-9-IMPORT-GRAPH — CI enforcement paper/live import-graph boundary

| Поле | Значение |
|------|----------|
| **depends_on** | — |
| **risk_level** | `low` |
| **estimated_hours** | 2 |
| **status** | `planned` |

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
- [ ] `tools/ci-paper-live-boundary.sh` exits 0 на текущем коде
- [ ] При добавлении запрещённого импорта в paper-trading-service → exits 1
- [ ] CI-джоб blocking (`continue-on-error: false`)
- [ ] Allowlist для будущих легитимных случаев задокументирован

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
