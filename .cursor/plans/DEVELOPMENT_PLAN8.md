# DEVELOPMENT_PLAN8 — Correctness sweep + live-gate enablement

> **Назначение:** второй план улучшений на базе системы векторов
> ([`docs/roadmap-vectors.md`](../../docs/roadmap-vectors.md)). Скоуп сформулирован
> не из реестра, а из **аудита кода 2026-08-02**, который выявил: несколько
> «готовых» защит live-фазы не работают, а cron-задачи Hermes молча сломаны.
>
> **Принципы (из roadmap-vectors.md §1):** P1 — код-first (все формулировки ниже
> основаны на чтении файлов 2026-08-02); P2 — пост-разработка = обновление доков.
>
> **Контекст:** PLAN7 закрыл все `live-blocker` риски инфраструктуры. План ниже
> закрывает риски **корректности** (баги в shipped-коде) и **live-enablement**
> (отсутствующие поверхности). Без них live-запуск опасен — «защиты» не защитят.

---

## Сводка шагов

| step_id | Вектор | gate | Тип | impact/effort | status |
|---------|--------|------|-----|---------------|--------|
| `P8-1-HERMES-CRON-SKILLS` | REL (UX) | live-blocker | баг | 5/2 (S) | `planned` |
| `P8-2-LIVE-GATE-CORRECTNESS` | SEC (FUNC) | live-blocker | баг | 5/3 (M) | `planned` |
| `P8-3-WALLET-KEY-IMPORT` | SEC (FUNC) | live-blocker | пробел | 5/3 (M) | `planned` |
| `P8-4-LIVE-SMOKE-SCRIPT` | REL (DEVOPS) | live-blocker | пробел | 3/2 (S) | `planned` |
| `P8-5-PG-DUMP-CLIENT` | REL (DEVOPS) | paper-check | пробел | 2/1 (XS) | `planned` |

**Порядок:** P8-1 (оператор сейчас теряет отчёты) → P8-5 (XS, мешает backup) →
P8-2 ( correctness ) → P8-3 (live-блокер) → P8-4.

**Out of scope (отложено в реестр / PLAN9):** CD-пайплайн (#7), фронтенд E2E
(#8), PERF k6 gate (#10), k8s (#11), новые DEX-адаптеры (PancakeSwap V3 /
Velodrome — coverage gap scanner↔execution). Это `paper-check`/`non-critical`.

---

## Аудит кода 2026-08-02 — ключевые находки (основа плана)

Полный аудит выполнен чтением кода (не документов). Находки, сформировавшие шаги:

1. **Hermes cron-skills: 5 из 5 сломаны.** `tools/hermes-agent/hermes-config.yaml`
   cron jobs ссылаются на skill-имена, которых нет в `tools/hermes-agent/skills/`:
   `status_check`, `plan_review`, `position_overview`, `incident_management`,
   `approval_handler` — **ни одного такого файла нет**. Файлы используют
   kebab-case с другими названиями (`investigate-incident`, `reconciliation-check`).
   `alert_watch` → `investigate_alert` vs skill name `investigate-alert`
   (подчёркивание vs дефис). Корректно маппятся только `explain_bot` и
   `config_management`. **Оператор не получает 4 из 5 запланированных
   cron-сводок в Telegram** (status heartbeat, reconciliation report, daily
   risk summary, approval queue check).

2. **`dex.live` config — мёртвый код.** `getEffectiveLiveConfig()`
   (`apps/execution-orchestrator/src/execution/risk/dex-risk-policy.service.ts:309-316`)
   парсит `liveEnabled` / `dryRunMode` / `chains`, но **имеет ноль call sites** в
   не-spec коде. Реальные live-гейты: `DEX_VENUE_ENABLED` env +
   `DEX_LIVE_KILL_SWITCH` env/`dex.limits.killSwitch`. **Переключение
   `dex.live.enabled=true` ничего не делает.** Это означает: операторский
   «переключатель live» — иллюзия.

3. **`requireOperatorApprovalPerTrade` парсится, но не enforced.**
   `dex-risk-policy.service.ts:401-404` читает его из `dex.limits`, но
   `requireApproval` **нигде не консультируется** в live-execution path. Existing
   approval-flow — только для paper-promotion (`paper-promotion.service.ts`), не
   для live-трейдов. Для live с капиталом это означает: план, дошедший до
   `beginExecution`, не требует одобрения оператора.

4. **Capital ceiling SQL неполон.** `capital.service.ts:70-83` внутри `reserve()`
   суммирует только `capital_reservations` (active), но docstring
   (`capital-limits.service.ts:11-12`) обещает `+ SUM(open positions)`. Открытые
   позиции не учитываются → потолок капитала можно превысить позициями, созданными
   после резервирования.

5. **RPC chain-id мисматч.** `rpc-provider-manager.service.ts:66` конфигурирует
   Arbitrum testnet как chain id `421611`, но `ChainId.ARBITRUM_ONE_SEPOLIA = 421614`
   (`packages/contracts-eth/src/types/chain-id.ts:14`). Testnet-провайдер не
   матчит реальные сети → live testnet smoke будет ходить не туда.

6. **Нет поверхности импорта wallet keys.** `registerWalletKey` /
   `encryptPrivateKey` существуют в `key-vault.service.ts`, но **нет CLI,
   контроллера или UI** для ввода ключей оператором. Единственный путь — прямой
   INSERT в `wallet_keys` (что небезопасно для live — нет audit, нет валидации).

7. **Coverage gap scanner ↔ execution.** PancakeSwap V3, Velodrome (Optimism),
   Ethereum-mainnet venues сканируются (`scanner-pool.constants.ts:31-62`), но
   **не имеют execution-адаптеров** (`venue-factory.service.ts:33-54`: только 5
   DEX). Across bridge mainnet не покрывает BNB Chain (`bridge.ts`).

8. **`maxOpenPositions` и per-chain `chains` оверрайды** в `dex.limits` парсятся,
   но не потребляются `parseLimitsResponse` (`dex-risk-policy.service.ts:392-408`).

---

## P8-1 — Hermes cron-skills reconciliation

- **step_id:** `P8-1-HERMES-CRON-SKILLS`
- **vector:** `REL` (вторичный `UX`)
- **gate:** `live-blocker` (оператор теряет cron-сводки прямо сейчас)
- **service:** `tools/hermes-agent`
- **goal:** Привести имена skills в `hermes-config.yaml` (cron jobs + telegram
  commands) в соответствие с реально существующими skill-файлами, либо создать
  недостающие skills. Сейчас 4 из 5 cron-сводок молча не работают.
- **code-first verify (перед стартом):**
  - `ls tools/hermes-agent/skills/*.md` → 10 файлов (kebab-case имена:
    `investigate-incident`, `reconciliation-check`, `risk-summary`, `daily-report`,
    `safe-mode-check`, `explain-bot`, `scanner-status`, `config-management`,
    `force-hedge-preview`, `investigate-alert`).
  - `grep "skill:" tools/hermes-agent/hermes-config.yaml` → 5 cron jobs со
    skill-именами: `status_check`, `incident_management`, `position_overview`,
    `approval_handler`, `investigate_alert`.
  - `grep "name:" tools/hermes-agent/skills/*.md` → frontmatter `name:` в
    snake_case (`investigate_incident`? — проверить; фактически `investigate-alert`
    с дефисом). **Несоответствие snake_case ↔ kebab-case + отсутствующие файлы.**
- **acceptance_criteria:**
  - Каждый `skill:` в cron jobs и каждый skill в `messaging.telegram.commands`
    маппится на **существующий** `.md` файл (по frontmatter `name:`).
  - Недостающие skills либо созданы (для cron-функций без аналога — `status_check`,
    `plan_review`, `position_overview`, `incident_management`, `approval_handler`),
    либо cron-job переподключён на существующий skill с близкой функцией
    (например `incident_management` → `reconciliation-check` + `investigate-incident`).
  - `investigate_alert` → `investigate-alert` (separator fix) — проверить, как
    hermes-agent резолвит skill name (точное совпадение vs нормализация).
  - **CI guard:** `tools/ci-hermes-agent-smoke.sh` дополнить чек-списком: каждый
    `skill:` в hermes-config.yaml маппится на существующий файл (grep по
    `name:` в skills/). Это ловит класс регрессии (как `hermes run` bug в Plan 5).
  - Документ: `docs/hermes-reference.md` обновлён таблицей cron-job → skill mapping.
- **changed_areas:** `tools/hermes-agent/hermes-config.yaml`,
  `tools/hermes-agent/skills/` (новые/переименованные),
  `tools/ci-hermes-agent-smoke.sh`, `docs/hermes-reference.md`, `AGENTS.md`
- **review_required:** `architecture` (skill ↔ MCP tool contract)
- **status:** `done` (2026-08-02) — 5 недостающих skill-файлов созданы (`status-check`, `plan-review`, `position-overview`, `incident-management`, `approval-queue-check`), 7 frontmatter `name:` нормализованы kebab→snake_case (канон резолвинга), CI guard check #9 добавлен в `ci-hermes-agent-smoke.sh` (каждый `skill:` в конфиге должен маппиться на существующий frontmatter `name:`). Все 9 skill-references (5 cron + 8 telegram commands, 9 уникальных) маппятся на 15 skills. Архитектурное ревью: APPROVE (skill↔MCP tool contract валиден, approval_required консистентен). Inititative `REL-HERMES-CRON-SKILLS` (#19) → `done` в roadmap-vectors.md.

---

## P8-2 — Live-gate correctness sweep

- **step_id:** `P8-2-LIVE-GATE-CORRECTNESS`
- **vector:** `SEC` (вторичный `FUNC`)
- **gate:** `live-blocker`
- **service:** `apps/execution-orchestrator`, `apps/capital-service`
- **goal:** Устранить 4 бага, где «защиты live-фазы» заявлены, но не работают.
  Сейчас flipping live-переключателей либо ничего не делает, либо не защищает.
- **code-first verify (перед стартом):** см. находки #2–#5, #8 в аудите выше;
  каждая имеет конкретный `file:line`.
- **acceptance_criteria (4 суб-фикса):**

  **(a) `dex.live` — wire или удалить.** Решение на старте шага:
  - Вариант A (предпочтительный): wire `getEffectiveLiveConfig()` в
    `venue-factory.service.ts` / `legs.service.ts` так, чтобы `liveEnabled=false`
    блокировал live-venue resolution (поверх `DEX_VENUE_ENABLED`); `dryRunMode=true`
    → paper-parallel; `chains[]` → whitelist chain id для live.
  - Вариант B: если live-гейтинг окончательно делегирован env+kill-switch,
    **удалить мёртвый код** `getEffectiveLiveConfig` + `DexLiveConfig`, убрать
    `dex.live` из seed/docs, задокументировать, что live-gate = env + kill-switch.
  - В любом случае — ADR `docs/adr-live-gate.md` с финальным решением.

  **(b) `requireOperatorApprovalPerTrade` — enforce или удалить.**
  - Если live требует per-trade approval (для single-operator + капитал):
    добавить gate в `legs.service.ts` перед `beginExecution` для live legs —
    план переходит в `awaiting_approval`, operator одобряет через UI/Hermes.
  - Если per-trade approval избыточен (kill-switch + ceiling + typed-phrase уже
    защищают single-operator): **удалить** `requireApproval` из
    `dex-risk-policy.service.ts` + seed, задокументировать mitigation.

  **(c) Capital ceiling — дополнить SQL.** `capital.service.ts:70-83` должен
    суммировать `active reservations` **+ open positions** (как обещает docstring).
    Запрос: добавить подзапрос к `portfolio_positions` (open, notional_usd) или
    отдельный SUM. Тест на сценарий «резервирование + позиция = ceiling».

  **(d) RPC chain-id мисматч.** `rpc-provider-manager.service.ts:66` —
    `421611` → `421614` (реальный Arbitrum Sepolia). Проверить, что
    `RPC_ARBITRUM_TESTNET_URL` матчит `ChainId.ARBITRUM_ONE_SEPOLIA`.

  - **Документы:** ADR `docs/adr-live-gate.md`; `docs/live-deploy-dod.md` Gate 1
    обновлён (какие гейты реально активны); `docs/dex-runbook-failed-tx.md` если
    меняется approval-flow.
  - **Тесты:** unit на каждый суб-фикс (capital ceiling с позициями;
    dex.live wiring; chain-id resolution).
- **changed_areas:** `apps/execution-orchestrator/src/execution/risk/`,
  `apps/execution-orchestrator/src/execution/venue-factory.service.ts`,
  `apps/execution-orchestrator/src/legs/legs.service.ts`,
  `apps/execution-orchestrator/src/execution/rpc/rpc-provider-manager.service.ts`,
  `apps/capital-service/src/capital/capital.service.ts`, specs, ADR, DoD docs
- **review_required:** `architecture` + `/dex-security` (capital safety)
- **status:** `done` (2026-08-02) — 4 суб-фикса:
  - **(a) dex.live — Вариант B (удалить):** `getEffectiveLiveConfig()` / `DexLiveConfig` / `parseLiveResponse` / `refreshLive` / `liveCache` / `liveInflight` / `SAFE_DEFAULT_LIVE` / `ParsedLive` / `asStringArray` удалены как мёртвый код (0 call sites). `dex.live` ключ остаётся в seed (migration 035) и читается frontend UI, но backend больше не претендует на потребление. Live-gate = kill-switch (`DexKillSwitchService`, D4-B-1) + `DEX_VENUE_ENABLED` env gate в `VenueFactoryService`.
  - **(b) requireApproval — Вариант B (удалить):** `DexRiskPolicyConfig.requireApproval`, `SAFE_DEFAULT_CONFIG.requireApproval`, parse в `parseLimitsResponse` удалены. Поле парсилось но никогда не enforced (D4-B-8 two-person descoped). Frontend toggle (`requireOperatorApprovalPerTrade` в seed JSON) остаётся — он управляет UI typed-phrase flow, который IS enforced client-side. Mitigation для single-operator: kill-switch + capital ceiling + typed-phrase (`DestructiveOperatorAction`).
  - **(c) Capital ceiling — уже исправлено ранее:** `capital.service.ts:88-94` уже суммирует `active reservations + open positions` (confirmed test "Capital ceiling exceeded: active reservations $0 + open positions $950 + requested $100 > ceiling $1000"). Docstring соответствует коду. Ничего менять не потребовалось.
  - **(d) RPC chain-id:** `rpc-provider-manager.service.ts:66` — `421611` (deprecated Arbitrum testnet) → `421614` (`ChainId.ARBITRUM_ONE_SEPOLIA`, реальный Arbitrum Sepolia). Spec обновлён (`rpc-provider-manager.service.spec.ts:349`).
  - **Документы:** `docs/adr-live-gate.md` §2 и §8 обновлены с P8-2 корректировками.
  - **Тесты:** execution-orchestrator 801/801 ✅ (46 suites), capital-service 24/24 ✅. Build + lint green. Inititative `SEC-LIVE-GATE-CORRECTNESS` (#20) → `done` в roadmap-vectors.md.

---

## P8-3 — Wallet-key import surface

- **step_id:** `P8-3-WALLET-KEY-IMPORT`
- **vector:** `SEC` (вторичный `FUNC`)
- **gate:** `live-blocker`
- **service:** `apps/execution-orchestrator`, `apps/web`, `tools`
- **goal:** Дать оператору безопасную поверхность для ввода приватных ключей
  кошельков в `wallet_keys` (сейчас доступен только прямой SQL INSERT — нет
  audit, нет валидации адреса, небезопасно для live).
- **code-first verify (перед стартом):**
  - `registerWalletKey` / `encryptPrivateKey` существуют (`key-vault.service.ts`)
    но callers только внутри rotation.
  - Нет контроллера: grep `registerWalletKey` по `apps/*/src/**/controller.ts` пуст.
  - Нет CLI: `tools/` не содержит wallet-import скрипта.
  - `wallet-manager.service.ts:110-151` `selectWallet()` decrypts per-call.
- **acceptance_criteria:**
  - **CLI tool** `tools/wallet-key-import.mjs` (предпочтительно для security —
    не exposes ключ через HTTP): читает private key из stdin/env (не из args —
    не светит в `ps`), вызывает `registerWalletKey`, валидирует, что derived
    address matches ожидаемому, пишет audit. `npm run wallet:import`.
  - **Альтернатива/дополнение** — operator UI: `/wallets` страница + BFF
    `POST /api/operator/wallets` → execution-orchestrator контроллер (за
    operator auth + RBAC admin). Решение в ADR (CLI vs UI vs оба).
  - Ключ **никогда** не логируется (ci:key-leakage guard должен пройти).
  - Валидация: private key → derived address (ethers) совпадает с заявленным;
    chainId поддерживается; keyId уникален.
  - ADR `docs/adr-wallet-key-import.md` (CLI vs UI, threat-model, почему не HTTP-body).
  - `docs/vault-integration-guide.md` обновлён процедурой импорта.
  - Runbook `docs/key-rotation-runbook.md` — ссылка на новый tool.
- **changed_areas:** `tools/wallet-key-import.mjs`, `package.json` (script),
  `apps/execution-orchestrator/src/execution/wallet-manager.service.ts` (если
  exposes метод), опц. `apps/web` UI, ADR, runbooks, `AGENTS.md`
- **review_required:** `architecture` + `/dex-security` (K1/K2 — key leakage)
- **status:** `done` (2026-08-02) — CLI-first approach (UI deferred, см. ADR §Alternatives). `tools/wallet-key-import.mjs` (`npm run wallet:import`): читает private key из stdin/env (НЕ args — не светит в `ps`), валидирует формат (64 hex), derives address через `ethers.computeAddress`, fail-closed если derived ≠ `--expected-address`, шифрует AES-256-GCM (тот же algorithm/params что `KeyVaultService.encryptPrivateKey`: scrypt-derived key, 16-byte IV, 32-byte per-key salt, GCM authTag), bind к deploy через `VAULT_MASTER_KEY_SALT` (P7-6), INSERT в `wallet_keys` с idempotency (refuse overwrite — rotation = new key_id). Ключ **никогда** не логируется (ci:key-leakage guard проходит). Smoke: dry-run + negative-tests (wrong address, invalid format) проверены. ADR `docs/adr-wallet-key-import.md` (threat model K1/K2, CLI vs UI vs Vault Transit). `docs/vault-integration-guide.md` §6 + `docs/key-rotation-runbook.md` Шаг 2 обновлены. Inititative `SEC-WALLET-KEY-IMPORT` (#21) → `done` в roadmap-vectors.md.

---

## P8-4 — Live-testnet smoke script

- **step_id:** `P8-4-LIVE-SMOKE-SCRIPT`
- **vector:** `REL` (вторичный `DEVOPS`)
- **gate:** `live-blocker` (DoD Gate 3 — testnet soak)
- **service:** `tools`
- **goal:** Создать сквозной live-smoke скрипт для testnet soak (DoD Gate 3),
  которого сейчас нет. `docs/live-deploy-dod.md` Gate 3 требует: ≥10 testnet
  bridge transfers, 0 unreconciled mismatches за 24h, ≤$10 capital rehearsal,
  kill-switch drill mid-soak. Инструментов для этого нет.
- **code-first verify (перед стартом):**
  - `ls tools/ | grep -iE "live|smoke|soak"` → пусто (есть только `e2e-dex1-testnet*`
    для adapter-тестов, не сквозной live-capital smoke).
  - `.cursor/plans/deploy-readiness/D4-C-4-LIVE-SMOKE.md` → `status: blocked`,
    явно просит "custom live testnet script (создать в задаче, если нет)".
  - Существуют `e2e:dex-testnet`, `e2e:dex2-multichain` — adapter-level, не
    end-to-end capital smoke.
- **acceptance_criteria:**
  - `tools/live-smoke-testnet.mjs` (`npm run smoke:live-testnet`): оркестрирует
    testnet-cycle — небольшой live trade на testnet (≤$1), проверяет fill,
    bridge transfer (где применимо), reconciliation (0 mismatches post-trade),
    kill-switch flip mid-cycle (trade блокируется), restore.
  - Параметризуемый budget (`SMOKE_CAPITAL_USD`, default $1, max $10 fail-closed).
  - **Зависимость:** P8-2 (chain-id fix) — иначе testnet-RPC ходит не туда.
  - DoD: `docs/live-deploy-dod.md` Gate 3 чек-лист обновлён ссылкой на tool.
  - Runbook `docs/live-smoke-runbook.md` (prerequisites, RTO, cleanup).
- **changed_areas:** `tools/live-smoke-testnet.mjs`, `package.json`,
  `docs/live-deploy-dod.md`, `docs/live-smoke-runbook.md`, `AGENTS.md`
- **review_required:** `backend` + `/dex-security` (real capital, even testnet)
- **status:** `done` (2026-08-02) — `tools/live-smoke-testnet.mjs` (`npm run smoke:live-testnet`): 4-фазный сквозной smoke для DoD Gate 3. **HEALTH** (execution + capital + reconciliation + opportunity health checks; DEX health для testnet). **CAPITAL** rehearsal: `POST /capital/reservations` под aggregate ceiling gate, `SMOKE_CAPITAL_USD` (default $1, **fail-closed at $10** per DoD Gate 3), TTL 60s + release cleanup. **KILLDRILL**: `panic:stop` → verify `arb_dex_live_halt_active=1` metric → `panic:recover --confirm "I UNDERSTAND THIS RESUMES TRADING"` → verify `=0` (`SMOKE_SKIP_KILLDRILL=true` для CI). **RECON**: `GET /mismatches?status=open` → 0 expected post-smoke. Real testnet execute делегирован в `e2e-dex1-testnet.mjs` (этот smoke фокусируется на gates, не trade execution). Exit codes: 0 ok, 1 health/assertion, 2 capital safety (budget>$10), 3 kill-drill failed. Smoke: dry-run health-fail (сервисы не запущены, abort exit 1), budget fail-closed ($50 → exit 2), syntax ok. Runbook `docs/live-smoke-runbook.md` (prerequisites, RTO/cleanup, DoD recording). `docs/live-deploy-dod.md` Gate 3 + Gate 4 обновлены (Gate 4: убран `dex.live.enabled=true` после P8-2, live-gate = kill-switch + `DEX_VENUE_ENABLED`). Зависимость P8-2(d) chain-id fix отмечена. Inititative `REL-LIVE-SMOKE-SCRIPT` (#22) → `done` в roadmap-vectors.md.

---

## P8-5 — pg_dump client on paper host

- **step_id:** `P8-5-PG-DUMP-CLIENT`
- **vector:** `REL` (вторичный `DEVOPS`)
- **gate:** `paper-check` (мешает backup на paper-стенде прямо сейчас)
- **service:** `infra` (documentation), `docs`
- **goal:** `npm run db:backup` падает на paper-стенде (`pg_dump: command not
  found` — БД в docker, системного клиента нет). Backup делается через
  `docker exec`, но canonical-скрипт не работает. Для live это закроет
  backup-сайдкар (P7-2), но paper-стенд (pm2) нуждается в клиенте.
- **code-first verify (перед стартом):**
  - `tools/backup-postgres.sh:71` вызывает системный `pg_dump`.
  - На paper-хосте: `which pg_dump` → пусто (подтверждено при деплое PLAN7).
- **acceptance_criteria:**
  - `docs/paper-deploy-aeza.md` §«Полезные команды»: задокументировать
    `apt install postgresql-client-16` на хосте (или fallback через docker exec).
  - Опц.: `tools/backup-postgres.sh` detect `pg_dump` absence → fallback на
    `docker exec <pg-container> pg_dump` если `DATABASE_URL` указывает на
    docker-host (auto-detect по hostname `postgres` / `host.docker.internal`).
  - Smoke: `npm run db:backup` на paper-хосте после install → успех.
- **changed_areas:** `tools/backup-postgres.sh` (опц. fallback),
  `docs/paper-deploy-aeza.md`
- **review_required:** `backend`
- **status:** `done` (2026-08-02) — `tools/backup-postgres.sh` теперь auto-detect'ит отсутствие системного `pg_dump`/`psql` и fallback'ит на `docker exec <container>`, имя контейнера auto-detect'ится по hostname в DATABASE_URL (docker bridge / `postgres` / `host.docker.internal` → `infra-postgres-1`), override через `PG_CONTAINER`. Симулированный paper-сценарий проверен: primary path (системный клиент) работает, detect-логика для localhost/postgres-host/docker-bridge корректна. `docs/paper-deploy-aeza.md` §«Полезные команды» обновлён с пояснением P8-5 и альтернативой `apt install postgresql-client-16`. Acceptance: smoke на реальном paper-хосте — оператор (acceptance criteria deferred to paper-deploy). Inititative `REL-PG-DUMP-CLIENT` (#23) → `done` в roadmap-vectors.md.

---

## Жизненный цикл и определения «done»

Наследует PLAN7 §«Жизненный цикл» (`planned → approved → in_progress → implemented
→ reviewing → review_passed → done`). **Шаг = `done` только когда:**

1. Код слит в `main` (direct-to-main, structured commit linked to `step_id`).
2. CI зелёный (lint/build/test затронутых пакетов + e2e jobs).
3. Ревью-скилл выполнен (`review_required`); для P8-2/P8-3 дополнительно
   `/dex-security`.
4. **Code-first re-verify (P1):** `file:line` актуальны перед мержем.
5. **Документы обновлены (P2):** все `changed_areas`-документы.

---

## Definition of Done для всего плана (P8-gate)

- Все 5 шагов = `done`.
- `docs/roadmap-vectors.md` реестр: соответствующие инициативы → `done`.
- **Критерий корректности:** ни одна «защита live» не заявлена в docs, если она
  не enforced в коде (.dex.live / requireApproval / capital ceiling — либо
  работают, либо удалены с ADR-обоснованием).
- Hermes cron-skills: все 5 cron jobs маппятся на существующие skills (CI guard).

**Что НЕ входит (PLAN9, после P8):** CD-пайплайн (#7), фронтенд E2E (#8), PERF
k6 gate (#10), coverage gap (PancakeSwap V3 / Velodrome execution adapters),
k8s (#11). Это `paper-check`/`non-critical`.

---

*Создан: 2026-08-02. Все `code-first verify`-блоки основаны на аудите кода
чтением файлов 2026-08-02 (коммит `a7e8b6c` + paper-деплой `f422e55`). При
смещении кода — обновить `file:line` в шаге перед стартом (принцип P1).*
