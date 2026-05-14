# DEX Documentation, UI и Runbooks (сквозные)

> Все шаги в состоянии `planned`. Зависят от соответствующих DEX-1/DEX-2 шагов.

---

## `DEX-DOC-FE` — Frontend: UI для DEX, кошельков и мостов

- **step_id:** `DEX-DOC-FE`
- **status:** `planned`
- **depends_on:** [`DEX-1-2-HEALTH`, `DEX-1-2-RECON-ONCHAIN`]
- **risk_level:** `low`
- **estimated_hours:** `8`
- **outputs:** UI spec (DEX-поля: txHash, chainId, gasUsed; секция кошельков; секция мостов для DEX-2)

---

## `DEX-DOC-RUNBOOK-TX` — Runbook: failed / stuck / reverted on-chain

- **step_id:** `DEX-DOC-RUNBOOK-TX`
- **status:** `planned`
- **depends_on:** [`DEX-1-1-ADAPTER-UNI2`]
- **risk_level:** `medium`
- **estimated_hours:** `6`
- **outputs:** `docs/dex-runbook-failed-tx.md`

---

## `DEX-DOC-RUNBOOK-BRIDGE` — Runbook: задержка моста, partial fill bridge

- **step_id:** `DEX-DOC-RUNBOOK-BRIDGE`
- **status:** `planned`
- **depends_on:** [`DEX-2-1-BRIDGE-ACROSS`]
- **risk_level:** `medium`
- **estimated_hours:** `6`
- **outputs:** `docs/dex-runbook-bridge-issues.md`

---

## `DEX-DOC-ROLLBACK` — Rollback strategy для DEX-компонентов

- **step_id:** `DEX-DOC-ROLLBACK`
- **status:** `planned`
- **depends_on:** [`DEX-1-0-VAULT`, `DEX-1-0-MIGRATIONS`]
- **risk_level:** `high`
- **estimated_hours:** `8`
- **outputs:** `docs/dex-rollback-runbook.md`, key rotation procedures, migration rollback procedures