# D4-C-2-VERSIONING — CHANGELOG + semver + git tags

| Поле | Значение |
|------|----------|
| **depends_on** | `D4-C-0-DAY2-ADR` |
| **risk_level** | `low` |
| **estimated_hours** | 3 |
| **status** | `done` |

## Контекст (из ревью)
Нет `CHANGELOG.md`, нет git-тегов (`git tag` пусто), нет `version` в корневом `package.json`. Образы тегируются по commit SHA + `latest`. Нет release-process doc (P5). Audit-трейл изменений и откат «на прошлый релиз» затруднены.

## Outputs
1. **`CHANGELOG.md`** — root, инициализировать с current state (paper-ready baseline) в формате Keep-a-Changelog
2. **`package.json`** root — `version: "0.1.0"` (pre-1.0, paper-phase) + `"private": true` (остаётся)
3. **Git tags** — первый тег `v0.1.0-paper` на текущий commit (baseline)
4. **`docs/release-process.md`** — процедура релиза:
   - Обновить CHANGELOG (ручной или `standard-version`)
   - Bump version в package.json
   - Tag `v<X.Y.Z>-<phase>` (например `-paper`, `-live`)
   - GHCR образы: помимо `latest`/SHA, тегировать `v<X.Y.Z>`
   - Rollback: `IMAGE_TAG=v<prev>` в compose-prod
5. **`.github/workflows/cd.yml`** — на git-tag `v*` дополнительно тегировать образы semver-тегом (не только SHA)
6. Обновить `docs/deployment-guide.md` §rollback — откат по semver-тегу

## Acceptance
- [x] `CHANGELOG.md` существует и описывает baseline (Keep-a-Changelog, [0.1.0-paper] — 2026-07-16 + Unreleased)
- [x] `package.json` имеет `version: "0.1.0"`
- [x] `docs/release-process.md` описывает процедуру (cut / rollback / hotfix / pre-1.0 contract)
- [x] `cd.yml` тегирует образы semver на tag-push (`type=ref,event=tag` добавлен к обоим metadata-action блокам: Nest services + web)
- [x] Rollback-процедура в deployment-guide §11 ссылается на semver-теги (`IMAGE_TAG=v0.1.0-paper`)
- [x] Git tag `v0.1.0-paper` — создан локально (annotated tag "v0.1.0-paper — paper-deploy baseline" dated 2026-07-16; `git tag -l 'v*'` → `v0.1.0-paper`). Push на remote — отдельная операторская задача (см. `docs/release-process.md`).

## Implementation notes
- `CHANGELOG.md` (root) — baseline release с полным списком Plan 4 Phase A/B, DEX, Hermes, Phase 1-4 изменений + Descoped секция для D4-B-8
- `package.json` root — `"version": "0.1.0"` (раньше отсутствовало)
- `docs/release-process.md` — процедура cut/rollback/hotfix, pre-1.0 instability contract
- `.github/workflows/cd.yml` — `type=ref,event=tag` в обоих metadata-action шагах (Nest + web) → semver-тег образа
- `docs/deployment-guide.md` §11 — обновлён rollback с примером semver-тега
- Git tag `v0.1.0-paper` будет создан на коммите, закрывающем Фазу C (после всех D4-C шагов)

## Edge Cases
- Pre-1.0 instability → minor bumps могут breaking (задокументировать)
- Private repo → tags видны только collaborator'ам (достаточно для paper)
- Hotfix branch → backport procedure в release-process

## Test Commands
```bash
# Проверить artifacts
test -f CHANGELOG.md
grep '"version"' package.json
git tag | grep v0.1.0
```

## Rollback
`git checkout -- package.json docs/deployment-guide.md .github/workflows/cd.yml` + `git tag -d v0.1.0-paper` + `rm CHANGELOG.md docs/release-process.md`
