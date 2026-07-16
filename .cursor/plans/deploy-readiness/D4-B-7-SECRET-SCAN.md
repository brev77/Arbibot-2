# D4-B-7-SECRET-SCAN — Сделать secret-scan CI блокирующим

| Поле | Значение |
|------|----------|
| **depends_on** | — |
| **risk_level** | `low` |
| **estimated_hours** | 1 |
| **status** | `done` |

## Контекст (из ревью)
В `.github/workflows/ci.yml` джоб `secret-scan` (`npm run ci:key-leakage`) идёт с `continue-on-error: true` (строка ~30). Регрессия по утечке ключа **не остановит merge**. K1/K2 guards отличные, но non-blocking (L7).

## Outputs
- `.github/workflows/ci.yml` — джоб `secret-scan`: `continue-on-error: false`
- Проверить, что текущий код проходит скан (нет false positives blocking legitimate code) — прогнать локально `npm run ci:key-leakage`
- Если есть false positives — поправить allowlist в `tools/ci-key-leakage.sh` (exclusions) ИЛИ исключить конкретные файлы
- Обновить комментарий в ci.yml (убрать «don't block until proven stable»)

## Acceptance
- [x] `secret-scan` джоб в ci.yml: `continue-on-error: false` — убрано (флаг удалён, дефолт = blocking)
- [x] Локальный прогон `npm run ci:key-leakage` exits 0 на текущем коде
- [x] Нет false positives, блокирующих легитимный код
- [x] (Опц.) gitleaks-джоб в security.yml уже blocking (без `continue-on-error`, по умолчанию action fail'ит PR)

## Implementation notes
- `.github/workflows/ci.yml`: removed `continue-on-error: true` from `secret-scan`, updated comment.
- `package.json`: added `ci:key-leakage` script (AGENTS.md documented it, but it was missing).
- `gitleaks-secrets` job in `security.yml` is already blocking (no `continue-on-error`; gitleaks-action@v2 fails on findings by default). Trivy/Checkov remain `exit-code: 0` / `soft_fail: true` (informational findings to Security tab — intentional).

## Edge Cases
- New legit code с pattern похожим на ключ → добавить в allowlist с комментарием-обоснованием
- Emergency hotfix когда scan ломается → временный revert + быстрый фикс (документировать, не норма)

## Test Commands
```bash
npm run ci:key-leakage   # локально, должен exit 0
```

## Rollback
`git checkout -- .github/workflows/ci.yml` + вернуть `continue-on-error: true`
