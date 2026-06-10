# H3-A-8-VERIFY — Верификация: npm ci + build + lint + test

| Поле | Значение |
|------|----------|
| **depends_on** | `H3-A-7-META` |
| **risk_level** | `critical` |
| **estimated_hours** | 1 |
| **status** | planned |

## Outputs
Зелёный CI-прогон

## Порядок
1. Удалить `package-lock.json` → `npm ci`
2. `npm run build` — 21/21 пакетов
3. `npm run lint` — 28/28 пакетов, 0 errors
4. `npm run test` — 392/392 тестов, 27 suites
5. `findstr /s /i "HERMES"` — 0 результатов в source

## Критерии успеха
- Build: 21/21 ✅
- Lint: 28/28 ✅
- Tests: 392/392 ✅
- Нет упоминаний `HERMES` в source (кроме dist/, .next/, node_modules/)

## Edge Cases
- `package-lock.json` содержит старый workspace name — регенерировать
- Test snapshots могут содержать старые имена классов — обновить

## Test Commands
```bash
npm ci
npm run build
npm run lint
npm run test
findstr /s /i /m "HERMES" apps\*.ts apps\*.tsx packages\persistence\src\*.ts
```

## Rollback
`git revert` или `git reset`