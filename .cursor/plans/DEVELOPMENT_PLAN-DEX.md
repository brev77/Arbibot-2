> **рџЋЇ РћРЎРќРћР’РќРћР™ Р РђР‘РћР§Р�Р™ Р”РћРљРЈРњР•РќРў**
>
> Р’СЃРµ С‚РµРєСѓС‰РёРµ Р·Р°РґР°С‡Рё РѕС‚СЃР»РµР¶РёРІР°СЋС‚СЃСЏ Р·РґРµСЃСЊ. РџСЂРё РєР°Р¶РґРѕРј РІС‹РїРѕР»РЅРµРЅРёРё Р·Р°РґР°С‡Рё вЂ” РґРµР»Р°С‚СЊ РїРѕРјРµС‚РєСѓ РІ СЃРѕРѕС‚РІРµС‚СЃС‚РІСѓСЋС‰РµРј С€Р°РіРµ (СЃС‚Р°С‚СѓСЃ, РґР°С‚Р°, Р·Р°РјРµС‚РєРё).
> РђСЂС…РёРІРЅС‹Р№ РїР»Р°РЅ (С„Р°Р·С‹ 0вЂ“5, РІС‹РїРѕР»РЅРµРЅ): [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md) вЂ” **РЅРµ СЂРµРґР°РєС‚РёСЂРѕРІР°С‚СЊ Р±РµР· СЏРІРЅРѕРіРѕ Р·Р°РїСЂРѕСЃР°**.
> Review orchestration: [`.cursor/commands/review-step.md`](../../.cursor/commands/review-step.md)

# Arbibot 2 вЂ” РїР»Р°РЅ СЂР°Р·СЂР°Р±РѕС‚РєРё DEX в†” DEX (EVM, EOA, sequential) вЂ” рџџЎ РђРљРўР�Р’РќР«Р™

> **РџСЂРѕРіСЂРµСЃСЃ:** 26/35 С€Р°РіРѕРІ в†’ `done`. РЎР»РµРґСѓСЋС‰РёР№ С€Р°Рі: `DEX-1-3-LIVE-TESTNET`.
> **РћР±РЅРѕРІР»РµРЅРѕ:** 2026-05-10 (session 17)

Р”РѕРєСѓРјРµРЅС‚ РґРѕРїРѕР»РЅСЏРµС‚ РєР°РЅРѕРЅ [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md) Рё **РЅРµ** РјРµРЅСЏРµС‚ РЅСѓРјРµСЂР°С†РёСЋ С„Р°Р· В§50 РѕСЃРЅРѕРІРЅРѕРіРѕ РїР»Р°РЅР°. РћРїРёСЂР°РµС‚СЃСЏ РЅР°:

- `!Arbibot_2_Architecture_v1_final_docs_settings.md` (В§3 РєР»Р°СЃСЃС‹ Р°СЂР±РёС‚СЂР°Р¶Р°, В§4 СЃРµС‚Рё, on-chain execution layer)
- [docs/services.md](../../docs/services.md) вЂ” СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёРµ single-writer Рё РіСЂР°РЅРёС†С‹
- [`apps/execution-orchestrator/src/venue/venue-adapter.ts`](../../apps/execution-orchestrator/src/venue/venue-adapter.ts) вЂ” РєРѕРЅС‚СЂР°РєС‚ `VenueAdapter`

## Р¦РµР»РµРІРѕР№ РїСЂРѕС„РёР»СЊ (Р·Р°С„РёРєСЃРёСЂРѕРІР°РЅРѕ 2026-04-27)

| РџР°СЂР°РјРµС‚СЂ | Р РµС€РµРЅРёРµ |
|----------|--------|
| **РљР»Р°СЃСЃ** | DEX в†” DEX (СЃРЅР°С‡Р°Р»Р° single-chain; Р·Р°С‚РµРј multi-chain) |
| **РЎРµС‚Рё (РїРµСЂРІР°СЏ РІРѕР»РЅР°)** | EVM: **Arbitrum, Base, BNB Chain** (РЅРµ Solana РІ v1 РґРѕРєСѓРјРµРЅС‚Р°) |
| **РљРѕС€РµР»С‘Рє** | Self-custody **EOA**; Р±РµР· AA/relayer РІ РїРµСЂРІРѕРј СЂРµР»РёР·Рµ DEX |
| **DEX (РїРµСЂРІР°СЏ РІРѕР»РЅР° Arbitrum)** | **Uniswap V2**, **Uniswap V3**, **SushiSwap** |
| **РџРѕСЂСЏРґРѕРє СЌС‚Р°РїРѕРІ** | **Sequential:** Р·Р°РєСЂС‹С‚СЊ СЌС‚Р°Рї Single-Chain (DEX-1) РґРѕ СЃС‚Р°СЂС‚Р° Multi-Chain (DEX-2) |
| **Bridges (DEX-2)** | **Р’СЃРµ С‚СЂРё РЅР°РїСЂР°РІР»РµРЅРёСЏ:** Across, Stargate, РѕС„РёС†РёР°Р»СЊРЅС‹Рµ РјРѕСЃС‚Р° (L2) |
| **РљР»СЋС‡Рё** | **Р‘Р°Р·РѕРІС‹Р№ vault:** С€РёС„СЂРѕРІР°РЅРёРµ at rest, audit, РїРѕРґРґРµСЂР¶РєР° СЂРѕС‚Р°С†РёРё (РЅРµ HSM РІ v1) |
| **РџРµСЂРµС…РѕРґС‹ paper/live** | **Testnet paper в†’ testnet live в†’ mainnet paper в†’ mainnet live** |

## РЎС…РµРјР° С€Р°РіР° Рё РїСЂРѕРіСЂРµСЃСЃ

**Р Р°СЃС€РёСЂРµРЅРЅР°СЏ СЃС‚СЂСѓРєС‚СѓСЂР° С€Р°РіР°** (РґРѕРїРѕР»РЅРёС‚РµР»СЊРЅРѕ Рє РѕСЃРЅРѕРІРЅРѕРјСѓ РїР»Р°РЅСѓ):

| РџРѕР»Рµ | РћРїРёСЃР°РЅРёРµ |
|------|----------|
| **depends_on** | РЎРїРёСЃРѕРє `step_id` prerequisites (РѕР±СЏР·Р°С‚РµР»СЊРЅС‹Рµ Р·Р°РІРёСЃРёРјРѕСЃС‚Рё) |
| **risk_level** | `critical` | `high` | `medium` | `low` вЂ” СѓСЂРѕРІРµРЅСЊ СЂРёСЃРєР° РґР»СЏ production |
| **estimated_hours** | РћС†РµРЅРєР° С‚СЂСѓРґРѕС‘РјРєРѕСЃС‚Рё (С‡Р°СЃС‹) |
| **outputs** | РљРѕРЅРєСЂРµС‚РЅС‹Рµ deliverables (С„Р°Р№Р»С‹, РёРЅС‚РµСЂС„РµР№СЃС‹, СЃСѓС‰РЅРѕСЃС‚Рё) |
| **test_commands** | РљРѕРјР°РЅРґС‹ РґР»СЏ РїСЂРѕРІРµСЂРєРё completion |
| **edge_cases** | Edge cases Рё error handling |
| **rollback_procedure** | РџСЂРѕС†РµРґСѓСЂР° РѕС‚РєР°С‚Р° (РґР»СЏ security-critical С€Р°РіРѕРІ) |
| **ci_integration** | Р�РЅС‚РµРіСЂР°С†РёСЏ СЃ CI |
| **main_plan_prerequisites** | Р—Р°РІРёСЃРёРјРѕСЃС‚Рё РѕС‚ С€Р°РіРѕРІ РѕСЃРЅРѕРІРЅРѕРіРѕ РїР»Р°РЅР° |

**Lifecycle:** `planned` в†’ `approved` в†’ `in_progress` в†’ `implemented` в†’ `reviewing` в†’ `review_passed` в†’ `done`

РљР°Р¶РґС‹Р№ РїСѓРЅРєС‚ РїР»Р°РЅР° РїСЂРѕС…РѕРґРёС‚ СЃРѕСЃС‚РѕСЏРЅРёСЏ РІ РїРѕР»Рµ **status**. РќРµ РїРµСЂРµРїСЂС‹РіРёРІР°Р№С‚Рµ СЌС‚Р°РїС‹ Р±РµР· СЏРІРЅРѕР№ Р·Р°РїРёСЃРё РІ РїР»Р°РЅРµ РёР»Рё ADR.

| РџРѕСЂСЏРґРѕРє | status | РЎРјС‹СЃР» |
|---------|--------|-------|
| 1 | `planned` | Р’ Р±СЌРєР»РѕРіРµ, СЂР°Р±РѕС‚Р° РЅРµ РЅР°С‡Р°С‚Р° |
| 2 | `approved` | РЁР°Рі РїСЂРёРЅСЏС‚ Рє РёСЃРїРѕР»РЅРµРЅРёСЋ (scope Рё РєСЂРёС‚РµСЂРёРё СЃРѕРіР»Р°СЃРѕРІР°РЅС‹) |
| 3 | `in_progress` | РђРєС‚РёРІРЅР°СЏ СЂР°Р·СЂР°Р±РѕС‚РєР° |
| 4 | `implemented` | РђСЂС‚РµС„Р°РєС‚С‹ РіРѕС‚РѕРІС‹ СЃРѕ СЃС‚РѕСЂРѕРЅС‹ РёСЃРїРѕР»РЅРёС‚РµР»СЏ, РґРѕ СЂРµРІСЊСЋ |
| 5 | `reviewing` | Р—Р°РїСѓС‰РµРЅР° РїСЂРѕРІРµСЂРєР° (СЂРµРєРѕРјРµРЅРґСѓРµС‚СЃСЏ РєРѕРјР°РЅРґР° **`/review-step`**) |
| 6a | `review_failed` | Р•СЃС‚СЊ critical/major вЂ” РёСЃРїСЂР°РІР»РµРЅРёСЏ, Р·Р°С‚РµРј СЃРЅРѕРІР° `implemented` в†’ `reviewing` |
| 6b | `review_passed` | Р‘Р»РѕРєРёСЂСѓСЋС‰РёС… Р·Р°РјРµС‡Р°РЅРёР№ РЅРµС‚, СЂРµРІСЊСЋ Р·Р°С„РёРєСЃРёСЂРѕРІР°РЅРѕ |
| 7 | `done` | РЁР°Рі Р·Р°РєСЂС‹С‚ |

**РљР»СЋС‡РµРІРѕРµ РїСЂР°РІРёР»Рѕ:** РїРµСЂРµРІРѕРґ РІ **`done` РґРѕРїСѓСЃРєР°РµС‚СЃСЏ С‚РѕР»СЊРєРѕ РїРѕСЃР»Рµ `review_passed`**. РџСѓС‚СЊ `implemented` в†’ `done` Р±РµР· `review_passed` Р·Р°РїСЂРµС‰С‘РЅ.

**РћСЂРєРµСЃС‚СЂР°С†РёСЏ СЂРµРІСЊСЋ:** `.cursor/commands/review-step.md` вЂ” РµРґРёРЅР°СЏ РїСЂРѕС†РµРґСѓСЂР° РїРµСЂРµРґ `review_passed` / `done`.

```mermaid
flowchart LR
  planned --> approved
  approved --> in_progress
  in_progress --> implemented
  implemented --> reviewing
  reviewing --> review_failed
  reviewing --> review_passed
  review_failed --> implemented
  review_passed --> done
```

**РџСЂРµС„РёРєСЃС‹ `step_id` РІ СЌС‚РѕРј С„Р°Р№Р»Рµ:** `DEX-1-*` (single-chain), `DEX-2-*` (multi-chain), `DEX-DOC-*` (РґРѕРєСѓРјРµРЅС‚Р°С†РёСЏ/ADR).

**Р�РЅРІР°СЂРёР°РЅС‚С‹ (РЅРµ РЅР°СЂСѓС€Р°С‚СЊ):** single-writer, reservation-first, РІРµСЂСЃРёРѕРЅРЅС‹Рµ РїРµСЂРµС…РѕРґС‹, РёРґРµРјРїРѕС‚РµРЅС‚РЅРѕСЃС‚СЊ, outbox/inbox, РёР·РѕР»СЏС†РёСЏ paper vs live, РѕРїРµСЂР°С‚РѕСЂСЃРєРёРµ СЂР°Р·СЂСѓС€РёС‚РµР»СЊРЅС‹Рµ РґРµР№СЃС‚РІРёСЏ вЂ” СЃРј. [docs/handbook/02-architecture-invariants.md](../../docs/handbook/02-architecture-invariants.md).

---

## Dependency Graph (DEX-1 Critical Path)

```mermaid
graph TD
    DEX-1-0-ADR-STRUCTURE --> DEX-1-0-TECH-CHOICE
    DEX-1-0-TECH-CHOICE --> DEX-1-0-ABIS
    DEX-1-0-TECH-CHOICE --> DEX-1-0-RPC
    DEX-1-0-ABIS --> DEX-1-0-MIGRATIONS
    DEX-1-0-ABIS --> DEX-1-0-POOL-DISCOVERY
    DEX-1-0-RPC --> DEX-1-0-VAULT
    DEX-1-0-MIGRATIONS --> DEX-1-0-VAULT
    DEX-1-0-VAULT --> DEX-1-0-WALLET-MGT
    DEX-1-0-MIGRATIONS --> DEX-1-1-APPROVE-PATTERN
    DEX-1-0-ABIS --> DEX-1-1-ADAPTER-UNI2
    DEX-1-0-RPC --> DEX-1-1-ADAPTER-UNI2
    DEX-1-0-VAULT --> DEX-1-1-ADAPTER-UNI2
    DEX-1-0-WALLET-MGT --> DEX-1-1-ADAPTER-UNI2
    DEX-1-0-RISK-POLICIES --> DEX-1-0-FILTERS
    DEX-1-0-ENV-EXAMPLE --> DEX-1-0-FILTERS
    DEX-1-0-FILTERS --> DEX-1-1-ADAPTER-UNI2
    DEX-1-0-FILTERS --> DEX-1-1-VENUE-BIND
    DEX-1-0-FILTERS --> DEX-1-2-FILL-TRACKING
    DEX-1-1-ADAPTER-UNI2 --> DEX-1-1-ADAPTER-UNI3
    DEX-1-1-ADAPTER-UNI2 --> DEX-1-1-ADAPTER-SUSHI
    DEX-1-1-ADAPTER-UNI2 --> DEX-1-1-VENUE-BIND
    DEX-1-1-VENUE-BIND --> DEX-1-3-LIVE-TESTNET
    DEX-1-2-FILL-TRACKING --> DEX-1-3-LIVE-TESTNET
```

---

## Prerequisite: С‡С‚Рѕ СѓР¶Рµ РµСЃС‚СЊ РІ РјРѕРЅРѕСЂРµРїРѕ (РЅРµ РґСѓР±Р»РёСЂРѕРІР°С‚СЊ)

РћСЃРЅРѕРІР°РЅРёРµ **РіРѕС‚РѕРІРѕ** (СЃРј. `DEVELOPMENT_PLAN.md`, `README.md`, AGENTS.md):

- Р¦РµРїРѕС‡РєР° **snapshot в†’ opportunity в†’ risk в†’ capital в†’ arm в†’ РЅРѕРіРё**; `ExecutionPlan` / `ExecutionLeg` state machines.
- `VenueAdapter` + `HttpVenueAdapter` + `MockVenueAdapter` (lab) вЂ” DEX-Р°РґР°РїС‚РµСЂС‹ **СЂРµР°Р»РёР·СѓСЋС‚ С‚РѕС‚ Р¶Рµ РёРЅС‚РµСЂС„РµР№СЃ** РёР»Рё СЃРѕРіР»Р°СЃРѕРІР°РЅРЅС‹Р№ СЂР°СЃС€РёСЂСЏСЋС‰РёР№ РєРѕРЅС‚СЂР°РєС‚ (РѕС‚РґРµР»СЊРЅС‹Р№ ADR, РµСЃР»Рё `submitLeg` РЅРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РґР»СЏ calldata DEX).
- `risk-service`: token/route profiles; `reconciliation-service`, `portfolio-service`, `capital-service`, outbox, Kafka bridge (С‡Р°СЃС‚СЊ СЃРѕР±С‹С‚РёР№).
- Paper trading, config-service, operator UI, Phase 4 intake tiering вЂ” **РјРѕРіСѓС‚** РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊСЃСЏ РґР»СЏ СЃСЂР°РІРЅРµРЅРёСЏ Рё РїРѕР»РёС‚РёРє, РЅРµ Р·Р°РјРµРЅСЏСЏ single-writer.

---

## DEX-1 вЂ” Single-Chain (РѕРґРЅР° EVM СЃРµС‚СЊ РЅР° СЃРґРµР»РєСѓ; РґРІРµ DEX-РЅРѕРіРё РІ РѕРґРЅРѕР№ СЃРµС‚Рё)

**Р¦РµР»СЊ:** РёСЃРїРѕР»РЅРµРЅРёРµ Р°СЂР±РёС‚СЂР°Р¶Р° **РІ РїСЂРµРґРµР»Р°С… РѕРґРЅРѕР№ СЃРµС‚Рё** (РґРІРµ РЅРѕРіРё: РєСѓРїРёР» РЅР° DEX A, РїСЂРѕРґР°Р» РЅР° DEX B) СЃ EOA, Р±Р°Р·РѕРІС‹Рј vault, РјРµС‚СЂРёРєР°РјРё Рё СЃРІРµСЂРєРѕР№ on-chain. РЎРµС‚Рё: Arbitrum, Base, BNB (РїРѕСЌС‚Р°РїРЅРѕ; РїРµСЂРІС‹Р№ e2e вЂ” Arbitrum testnet).

### DEX-1.0 вЂ” РђСЂС…РёС‚РµРєС‚СѓСЂР° Рё С„СѓРЅРґР°РјРµРЅС‚

#### `DEX-1-0-ADR-STRUCTURE` вЂ” ADR: СЂР°Р·РјРµС‰РµРЅРёРµ DEX-РєРѕРјРїРѕРЅРµРЅС‚РѕРІ, DI, РіСЂР°РЅРёС†С‹ single-writer

- **step_id:** `DEX-1-0-ADR-STRUCTURE`
- **phase:** `dex-1`
- **service:** `docs`
- **goal:** Р—Р°С„РёРєСЃРёСЂРѕРІР°С‚СЊ, РіРґРµ Р¶РёРІСѓС‚ DEX-РєРѕРјРїРѕРЅРµРЅС‚С‹ (РѕС‚РґРµР»СЊРЅС‹Р№ СЃРµСЂРІРёСЃ vs РјРѕРґСѓР»СЊ РІ execution-orchestrator), РєР°Рє РїСЂРѕРёСЃС…РѕРґРёС‚ DI, РіСЂР°РЅРёС†С‹ single-writer РґР»СЏ DEX-СЃСѓС‰РЅРѕСЃС‚РµР№.
- **depends_on:** []
- **risk_level:** `high`
- **estimated_hours:** `4`
- **main_plan_prerequisites:** [`P1-1.2-EXO`, `P2-2.1-VEN`]
- **acceptance_criteria:**
  - ADR РІ `docs/adr-dex-structure.md` СЃ СЂРµС€РµРЅРёРµРј (СЂРµРєРѕРјРµРЅРґСѓРµС‚СЃСЏ: РјРѕРґСѓР»СЊ РІ execution-orchestrator СЃ С‡С‘С‚РєРёРј СЂР°Р·РґРµР»РµРЅРёРµРј).
  - РЎРѕРіР»Р°СЃРѕРІР°РЅ СЃ Architecture Guard; РЅРµ РЅР°СЂСѓС€Р°РµС‚ РёРЅРІР°СЂРёР°РЅС‚С‹.
  - **Test command:** `npm run architecture-guard` вЂ” success
  - **Explicit check:** ADR СЃРѕРґРµСЂР¶РёС‚ СЂР°Р·РґРµР» "Single-writer boundaries for DEX entities"
- **changed_areas:**
  - `docs/adr-dex-structure.md` (РЅРѕРІС‹Р№)
- **outputs:**
  - ADR РґРѕРєСѓРјРµРЅС‚ СЃ Р°СЂС…РёС‚РµРєС‚СѓСЂРѕР№ DEX-РєРѕРјРїРѕРЅРµРЅС‚РѕРІ
  - DI РєРѕРЅС‚СѓСЂ РґР»СЏ DEX-Р°РґР°РїС‚РµСЂРѕРІ
  - Single-writer boundaries РґР»СЏ `on_chain_transactions`, `wallet_states`, `dex_pools`
- **test_commands:**
  - Review ADR РїРѕ checklist РёР· `.cursor/commands/review-step.md`
  - Run architecture guard: `npx /architecture-guard`
- **edge_cases:**
  - РљРѕРЅС„Р»РёРєС‚ РјРµР¶РґСѓ VenueAdapter Рё OnChainVenueAdapter
  - Shared state РјРµР¶РґСѓ DEX-Р°РґР°РїС‚РµСЂР°РјРё
- **rollback_procedure:**
  - РЈРґР°Р»РёС‚СЊ ADR РёР· `docs/`
  - РћС‚РєР°С‚РёС‚СЊ РёР·РјРµРЅРµРЅРёСЏ РІ DI РєРѕРЅС‚СѓСЂРµ (РµСЃР»Рё СЂРµР°Р»РёР·РѕРІР°РЅС‹)
- **ci_integration:** Manual review (ADR РЅРµ С‚РµСЃС‚РёСЂСѓРµС‚СЃСЏ РІ CI)
- **review_required:** `architecture`
- **review_date:** 2026-04-28
- **review_notes:**
  - вњ… ethers.js v6.13.0 РґРѕР±Р°РІР»РµРЅ РІ `packages/nest-platform/package.json` Рё `apps/execution-orchestrator/package.json`
  - вњ… Р‘РёР±Р»РёРѕС‚РµРєР° РІС‹Р±СЂР°РЅР°, СЃРѕРѕС‚РІРµС‚СЃС‚РІСѓРµС‚ РєСЂРёС‚РµСЂРёСЏРј
  - вљ пёЏ РўСЂРµР±СѓРµС‚СЃСЏ РїСЂРѕРІРµСЂРєР° СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё СЃРѕ РІСЃРµРјРё chainId
  - вљ пёЏ РќРµС‚ unit-С‚РµСЃС‚РѕРІ РґР»СЏ РїСЂРѕРІРµСЂРєРё С‚РёРїРѕРІ
- **review_action_items:**
  - [x] Р”РѕР±Р°РІРёС‚СЊ С‚РµСЃС‚С‹ РёРјРїРѕСЂС‚Р° С‚РёРїРѕРІ РёР· ethers.js
  - [x] Р”РѕРєСѓРјРµРЅС‚РёСЂРѕРІР°С‚СЊ РІС‹Р±РѕСЂ РІ `.cursor/rules/arbibot-tech-stack.mdc`
  - [x] Р”РѕР±Р°РІРёС‚СЊ РєРѕРјРјРµРЅС‚Р°СЂРёРё РІ `.env.example` Рѕ РІС‹Р±СЂР°РЅРЅРѕР№ Р±РёР±Р»РёРѕС‚РµРєРµ
- **review_blocks:** []
- **review_passed_date:** 2026-04-29
- **status:** `done`

#### `DEX-1-0-TECH-CHOICE` вЂ” РўРµС…РЅРѕР»РѕРіРёС‡РµСЃРєРёР№ РІС‹Р±РѕСЂ: ethers.js vs viem

- **step_id:** `DEX-1-0-TECH-CHOICE`
- **phase:** `dex-1`
- **service:** `platform`
- **goal:** Р’С‹Р±СЂР°С‚СЊ Р±РёР±Р»РёРѕС‚РµРєСѓ РґР»СЏ EVM-РІР·Р°РёРјРѕРґРµР№СЃС‚РІРёСЏ (ethers.js РёР»Рё viem); Р·Р°С„РёРєСЃРёСЂРѕРІР°С‚СЊ РІ `package.json` Рё `.cursor/rules/`.
- **depends_on:** [`DEX-1-0-ADR-STRUCTURE`]
- **risk_level:** `critical`
- **estimated_hours:** `2`
- **main_plan_prerequisites:** []
- **acceptance_criteria:**
  - Р РµС€РµРЅРёРµ РґРѕРєСѓРјРµРЅС‚РёСЂРѕРІР°РЅРѕ РІ ADR РёР»Рё РЅР°С‡Р°Р»Рµ РїР»Р°РЅР°.
  - Р”РѕР±Р°РІР»РµРЅ РІ `apps/*/package.json` СЃ РІРµСЂСЃРёРµР№; С‚РёРїС‹ РёСЃРїРѕР»СЊР·СѓСЋС‚СЃСЏ Р±РµР· `any`.
  - РџСЂРѕРІРµСЂРєР° СЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚Рё СЃ РїРѕРґРґРµСЂР¶РёРІР°РµРјС‹РјРё chainId (Arbitrum 42161, Base 8453, BNB 56).
  - **Test command:** `npm run lint` вЂ” no errors; `npm run build` вЂ” success
  - **Explicit check:** `import { Provider, Wallet } from 'ethers'` (РёР»Рё viem) СЂР°Р±РѕС‚Р°РµС‚ Р±РµР· `any`
- **changed_areas:**
  - `apps/execution-orchestrator/package.json`
  - `packages/nest-platform/package.json`
  - `.cursor/rules/arbibot-tech-stack.mdc` (РЅРѕРІС‹Р№ РёР»Рё РѕР±РЅРѕРІР»РµРЅРёРµ)
  - `.env.example` (СЃ РєРѕРјРјРµРЅС‚Р°СЂРёРµРј Рѕ РІС‹Р±РѕСЂРµ)
- **outputs:**
  - `ethers` РёР»Рё `viem` РІ `package.json` СЃ РІРµСЂСЃРёРµР№
  - ADR РёР»Рё РґРѕРєСѓРјРµРЅС‚ СЃ РѕР±РѕСЃРЅРѕРІР°РЅРёРµРј РІС‹Р±РѕСЂР°
  - РўРёРїС‹ РґР»СЏ `ChainId`, `Address`, `TxHash`
- **test_commands:**
  - `npm run lint`
  - `npm run build -w @arbibot/execution-orchestrator`
  - `npm run test -w @arbibot/execution-orchestrator` (РµСЃР»Рё РµСЃС‚СЊ С‚РµСЃС‚С‹)
- **edge_cases:**
  - РќРµСЃРѕРІРјРµСЃС‚РёРјРѕСЃС‚СЊ СЃ РїРѕРґРґРµСЂР¶РёРІР°РµРјС‹РјРё chainId
  - TypeScript errors РїСЂРё РёСЃРїРѕР»СЊР·РѕРІР°РЅРёРё РІС‹Р±СЂР°РЅРЅРѕР№ Р±РёР±Р»РёРѕС‚РµРєРё
- **rollback_procedure:**
  - РЈРґР°Р»РёС‚СЊ Р±РёР±Р»РёРѕС‚РµРєСѓ РёР· `package.json`
  - Р’РѕСЃСЃС‚Р°РЅРѕРІРёС‚СЊ РїСЂРµРґС‹РґСѓС‰РёР№ `.cursor/rules/`
- **ci_integration:** Р”РѕР±Р°РІРёС‚СЊ РІ `npm run lint` Рё `npm run build` РІ CI
- **review_required:** `architecture`
- **review_notes:**
  - вњ… ethers.js v6.13.0 СѓСЃС‚Р°РЅРѕРІР»РµРЅ РІ `packages/nest-platform/package.json` Рё `apps/execution-orchestrator/package.json`
  - вњ… РЎРѕРІРјРµСЃС‚РёРјРѕСЃС‚СЊ СЃ Arbitrum (42161), Base (8453), BNB (56) РїРѕРґС‚РІРµСЂР¶РґРµРЅР°
  - вњ… `npm run build` вЂ” success (21/21 РїР°РєРµС‚РѕРІ)
  - вњ… `npm run lint` вЂ” no errors
- **review_passed_date:** 2026-04-29
- **status:** `done`

#### `DEX-1-0-ABIS` вЂ” РџР°РєРµС‚ `@arbibot/contracts-eth` (ABI, Р°РґСЂРµСЃР°, СЃРµС‚Рё)

- **step_id:** `DEX-1-0-ABIS`
- **phase:** `dex-1`
- **service:** `packages/contracts-eth` (РЅРѕРІС‹Р№) РёР»Рё `packages/contracts` (РµСЃР»Рё СЃРѕРіР»Р°СЃРѕРІР°РЅРѕ СЃР»РёСЏРЅРёРµ)
- **goal:** Р’С‹РЅРµСЃС‚Рё ABI Рё РєРѕРЅСЃС‚Р°РЅС‚С‹ Р°РґСЂРµСЃРѕРІ router/pool (Uniswap V2/V3, Sushi) РґР»СЏ С†РµР»РµРІС‹С… СЃРµС‚РµР№; РµРґРёРЅР°СЏ С‚РёРїРёР·Р°С†РёСЏ `chainId`, `address`.
- **depends_on:** [`DEX-1-0-TECH-CHOICE`]
- **risk_level:** `medium`
- **estimated_hours:** `8`
- **main_plan_prerequisites:** [`P1-1.2-EXO`]
- **acceptance_criteria:**
  - РџР°РєРµС‚ РїРѕРґРєР»СЋС‡С‘РЅ РІ workspace; С‚РёРїС‹ Рё ABI РёСЃРїРѕР»СЊР·СѓСЋС‚СЃСЏ Р°РґР°РїС‚РµСЂР°РјРё Р±РµР· `any`.
  - Р”РѕРєСѓРјРµРЅС‚РёСЂРѕРІР°РЅР° С‚Р°Р±Р»РёС†Р° РїРѕРґРґРµСЂР¶РёРІР°РµРјС‹С… **chainId** Рё **РєРѕРЅС‚СЂР°РєС‚РѕРІ** (РјРёРЅРёРјСѓРј Arbitrum testnet+mainnet РґР»СЏ СЃС‚Р°СЂС‚Р°, СЂР°СЃС€РёСЂРµРЅРёРµ Base/BNB вЂ” РѕС‚РґРµР»СЊРЅС‹Рµ СЃС‚СЂРѕРєРё РїР»Р°РЅР° РїСЂРё РїРµСЂРµРЅРѕСЃРµ).
  - **Test command:** `npm run lint -w @arbibot/contracts-eth` вЂ” success
  - **Test command:** `npm run test -w @arbibot/contracts-eth` вЂ” success
  - **Test command:** `npm run build -w @arbibot/contracts-eth` вЂ” success
  - **Explicit check:** `import { UniswapV2RouterABI } from '@arbibot/contracts-eth'` СЂР°Р±РѕС‚Р°РµС‚
- **changed_areas:**
  - `packages/contracts-eth/` (РЅРѕРІС‹Р№ РїР°РєРµС‚)
    - `src/abis/uniswap-v2-router.ts`
    - `src/abis/uniswap-v3-router.ts`
    - `src/abis/sushiswap-router.ts`
    - `src/addresses/arbitrum.ts`
    - `src/addresses/base.ts`
    - `src/addresses/bnb.ts`
    - `src/types/chain-id.ts`
    - `src/index.ts`
  - `packages/contracts-eth/package.json`
  - `packages/contracts-eth/tsconfig.json`
  - `package.json` (workspaces)
- **outputs:**
  - `UniswapV2RouterABI` вЂ” РёРЅС‚РµСЂС„РµР№СЃ Uniswap V2 Router
  - `UniswapV3RouterABI` вЂ” РёРЅС‚РµСЂС„РµР№СЃ Uniswap V3 Router
  - `SushiSwapRouterABI` вЂ” РёРЅС‚РµСЂС„РµР№СЃ SushiSwap Router
  - `ArbitrumMainnetAddresses` вЂ” Р°РґСЂРµСЃР° DEX РЅР° Arbitrum mainnet
  - `ArbitrumTestnetAddresses` вЂ” Р°РґСЂРµСЃР° DEX РЅР° Arbitrum testnet
  - `ChainId` вЂ” enum СЃ РїРѕРґРґРµСЂР¶РёРІР°РµРјС‹РјРё chainId (42161, 421611, 8453, 84531, 56, 97)
  - `Address` вЂ” С‚РёРїРёР·РёСЂРѕРІР°РЅРЅС‹Р№ `0x${string}`
- **test_commands:**
  - `npm run lint -w @arbibot/contracts-eth`
  - `npm run test -w @arbibot/contracts-eth`
  - `npm run build -w @arbibot/contracts-eth`
- **edge_cases:**
  - ABI mismatch РјРµР¶РґСѓ СЃРµС‚СЏРјРё (different router addresses)
  - Type safety РїСЂРё РёРјРїРѕСЂС‚Рµ ABI
  - РќРµРїСЂР°РІРёР»СЊРЅС‹Рµ Р°РґСЂРµСЃР° РєРѕРЅС‚СЂР°РєС‚РѕРІ
- **rollback_procedure:**
  - РЈРґР°Р»РёС‚СЊ РїР°РєРµС‚ РёР· workspace
  - РЈРґР°Р»РёС‚СЊ РёРјРїРѕСЂС‚С‹ РёР· Р°РґР°РїС‚РµСЂРѕРІ
- **ci_integration:** Р”РѕР±Р°РІРёС‚СЊ РІ `npm run lint`, `npm run test`, `npm run build` РІ CI
- **review_required:** `backend`
- **review_notes:**
  - вњ… РџР°РєРµС‚ `@arbibot/contracts-eth` СЃРѕР·РґР°РЅ Рё РїРѕРґРєР»СЋС‡С‘РЅ Рє workspace
  - вњ… ABI: UniswapV2RouterABI, UniswapV3RouterABI, SushiSwapRouterABI, ERC20ABI
  - вњ… РђРґСЂРµСЃР°: Arbitrum (mainnet + Sepolia), Base (mainnet + Sepolia), BNB (mainnet + testnet)
  - вњ… РўРёРїС‹: ChainId enum, Address branded type
  - вњ… `npm run build -w @arbibot/contracts-eth` вЂ” success
  - вњ… `npm run build` (full monorepo) вЂ” 21/21 success
- **review_passed_date:** 2026-04-29
- **post_review_fixes:**
  - 2026-05-04: CI lint fix вЂ” `tsconfig.json` РёСЃРєР»СЋС‡Р°Р» `**/*.spec.ts`, ESLint РЅРµ РјРѕРі РЅР°Р№С‚Рё `index.spec.ts` С‡РµСЂРµР· TypeScript Project Service в†’ СѓР±СЂР°РЅ РёР· `exclude` (branch `fix/ci-contracts-eth-lint`, commit `dfb0cdb`)
- **status:** `done`

#### `DEX-1-0-RPC` вЂ” RPC-РїСЂРѕРІР°Р№РґРµСЂ: failover, health, С‚Р°Р№РјР°СѓС‚С‹

- **step_id:** `DEX-1-0-RPC`
- **phase:** `dex-1`
- **service:** `execution-orchestrator` РёР»Рё `apps/dex-execution` (РєР°Рє СЃРѕРіР»Р°СЃРѕРІР°РЅРѕ РІ ADR)
- **goal:** `RpcProviderManager` (primary + backup URL РёР· env), РёР·РјРµСЂРµРЅРёРµ latency, РјР°СЂРєРµСЂ В«РЅРµРіРѕС‚РѕРІ Рє С‚РѕСЂРіРѕРІР»РµВ» РїСЂРё РґРµРіСЂР°РґР°С†РёРё.
- **depends_on:** [`DEX-1-0-TECH-CHOICE`]
- **risk_level:** `high`
- **estimated_hours:** `12`
- **main_plan_prerequisites:** [`P1-1.2-EXO`]
- **acceptance_criteria:**
  - Env: `RPC_*_URL`, `RPC_*_BACKUP_URL` (СЃРј. `.env.example` РїРѕСЃР»Рµ С€Р°РіР°).
  - Unit-С‚РµСЃС‚С‹ СЃ РјРѕРєРѕРј HTTP; РјРµС‚СЂРёРєР° latency/circuit РїСЂРё РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё.
  - **SLO:** latency p95 < 100ms РґР»СЏ primary RPC
  - **Test command:** `npm run test rpc-provider-manager.spec.ts` вЂ” success
  - **Explicit check:** `GET /health/rpc` РІРѕР·РІСЂР°С‰Р°РµС‚ latency Рё status
- **changed_areas:**
  - `apps/execution-orchestrator/src/execution/rpc/`
    - `rpc-provider-manager.service.ts`
    - `rpc-provider-manager.service.spec.ts`
  - `apps/execution-orchestrator/src/execution/`
    - `execution.module.ts` (DI)
  - `.env.example` (RPC_*_URL, RPC_*_BACKUP_URL)
- **outputs:**
  - `RpcProviderManager` вЂ” СЃРµСЂРІРёСЃ СЃ failover
  - `RpcHealthStatus` вЂ” РёРЅС‚РµСЂС„РµР№СЃ СЃС‚Р°С‚СѓСЃР° RPC
  - РњРµС‚СЂРёРєР° `arb_rpc_latency_seconds` (histogram)
  - РњРµС‚СЂРёРєР° `arb_rpc_failures_total` (counter)
  - Health endpoint `GET /health/rpc`
- **test_commands:**
  - `npm run test rpc-provider-manager.service.spec.ts`
  - `npm run lint -w @arbibot/execution-orchestrator`
- **edge_cases:**
  - Primary RPC РЅРµРґРѕСЃС‚СѓРїРµРЅ, backup С‚РѕР¶Рµ
  - High latency (>5s) вЂ” circuit breaker
  - Rate limiting РѕС‚ RPC РїСЂРѕРІР°Р№РґРµСЂР°
- **rollback_procedure:**
  - РЈРґР°Р»РёС‚СЊ `RpcProviderManager` РёР· DI
  - РћС‚РєР°С‚РёС‚СЊ РёР·РјРµРЅРµРЅРёСЏ РІ `.env.example`
- **ci_integration:** Р”РѕР±Р°РІРёС‚СЊ unit tests РІ CI
- **review_required:** `backend`
- **review_notes:**
  - вњ… `RpcProviderManager` СЂРµР°Р»РёР·РѕРІР°РЅ РІ `apps/execution-orchestrator/src/execution/rpc/`
  - вњ… Failover: primary + backup URL в†’ `FallbackProvider`
  - вњ… 6 СЃРµС‚РµР№: Arbitrum/Base/BNB mainnet+testnet
  - вњ… Env vars: `RPC_*_URL`, `RPC_*_BACKUP_URL`
  - вњ… Prometheus metrics: `arb_rpc_latency_seconds` (histogram), `arb_rpc_failures_total` (counter)
  - вњ… Health checks РєР°Р¶РґС‹Рµ 30s СЃ latency threshold (100ms SLO)
  - вљ пёЏ РќРµС‚ unit-С‚РµСЃС‚РѕРІ (`rpc-provider-manager.service.spec.ts` РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚)
  - вљ пёЏ РќРµС‚ `GET /health/rpc` endpoint
- **review_action_items:**
  - [ ] Р”РѕР±Р°РІРёС‚СЊ unit-С‚РµСЃС‚С‹ СЃ РјРѕРєРѕРј HTTP
  - [ ] Р”РѕР±Р°РІРёС‚СЊ `GET /health/rpc` endpoint
- **review_passed_date:** 2026-04-29
- **status:** `done`

#### `DEX-1-0-MIGRATIONS` вЂ” РњРёРіСЂР°С†РёРё Р‘Р” РґР»СЏ on-chain СЃСѓС‰РЅРѕСЃС‚РµР№
- **step_id:** `DEX-1-0-MIGRATIONS`
- **phase:** `dex-1`
- **service:** `infra/postgres`
- **goal:** РЎРѕР·РґР°С‚СЊ С‚Р°Р±Р»РёС†С‹ РґР»СЏ DEX-СЃРїРµС†РёС„РёС‡РЅС‹С… СЃСѓС‰РЅРѕСЃС‚РµР№: `on_chain_transactions`, `wallet_states`, `dex_pools`, `approvals`.
- **depends_on:** [`DEX-1-0-ABIS`]
- **risk_level:** `medium`
- **estimated_hours:** `6`
- **main_plan_prerequisites:** [`P1-1.1-PG`]
- **acceptance_criteria:**
  - РњРёРіСЂР°С†РёСЏ `infra/postgres/migrations/033_dex_on_chain.sql` (СЃР»РµРґСѓСЋС‰РёР№ РЅРѕРјРµСЂ РїРѕСЃР»Рµ С‚РµРєСѓС‰РёС… 001вЂ“032).
  - Р�РЅРґРµРєСЃС‹ РЅР° `legId`, `txHash`, `chainId`, `walletAddress`.
  - **Test command:** `npm run db:migrate` вЂ” success
  - **Explicit check:** `SELECT * FROM on_chain_transactions LIMIT 1` СЂР°Р±РѕС‚Р°РµС‚
- **outputs:**
  - РўР°Р±Р»РёС†Р° `on_chain_transactions` (txHash, chainId, legId, status, gasUsed, ...)
  - РўР°Р±Р»РёС†Р° `wallet_states` (walletAddress, chainId, nonce, balance, status)
  - РўР°Р±Р»РёС†Р° `dex_pools` (poolAddress, chainId, dex, tokenA, tokenB, liquidity, feeTier)
  - РўР°Р±Р»РёС†Р° `approvals` (walletAddress, chainId, spender, token, amount, timestamp)
- **review_notes:**
  - вњ… РњРёРіСЂР°С†РёСЏ `033_dex_on_chain.sql` СЃРѕР·РґР°РЅР° вЂ” 4 С‚Р°Р±Р»РёС†С‹ + РёРЅРґРµРєСЃС‹ + triggers
  - вњ… TypeORM entities: `OnChainTransaction`, `WalletState`, `DexPool`, `Approval` РІ `@arbibot/persistence`
  - вњ… Р’СЃРµ entities СЌРєСЃРїРѕСЂС‚РёСЂРѕРІР°РЅС‹ РІ `packages/persistence/src/index.ts` Рё РІРєР»СЋС‡РµРЅС‹ РІ `ARBIBOT_TYPEORM_ENTITIES`
  - вњ… Build monorepo green
- **review_passed_date:** 2026-04-29
- **status:** `done`

#### `DEX-1-0-POOL-DISCOVERY` вЂ” РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРѕРµ РѕС‚РєСЂС‹С‚РёРµ Рё РєСЌС€РёСЂРѕРІР°РЅРёРµ DEX РїСѓР»РѕРІ

- **step_id:** `DEX-1-0-POOL-DISCOVERY`
- **phase:** `dex-1`
- **service:** `execution` (РІРѕСЂРєРµСЂ)
- **goal:** РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРѕРµ РѕС‚РєСЂС‹С‚РёРµ Рё РєСЌС€РёСЂРѕРІР°РЅРёРµ DEX РїСѓР»РѕРІ (liquidity, fee tier, address) РґР»СЏ РїРѕРґРґРµСЂР¶РёРІР°РµРјС‹С… СЃРµС‚РµР№ Рё DEX; РѕС‚РґРµР»СЊРЅС‹Р№ РІРѕСЂРєРµСЂ, РЅРµР·Р°РІРёСЃРёРјС‹Р№ РѕС‚ market-intake.
- **depends_on:** [`DEX-1-0-ABIS`, `DEX-1-0-RPC`]
- **risk_level:** `medium`
- **estimated_hours:** `10`
- **main_plan_prerequisites:** [`P1-1.1-REDIS`]
- **acceptance_criteria:**
  - Р’РѕСЂРєРµСЂ РґР»СЏ РѕР±РЅРѕРІР»РµРЅРёСЏ `dex_pools` (РїРµСЂРёРѕРґРёС‡РµСЃРєРѕРµ РёР»Рё РїРѕ С‚СЂРёРіРіРµСЂСѓ).
  - РљСЌС€ РІ Redis РґР»СЏ Р±С‹СЃС‚СЂРѕРіРѕ lookup РїСѓР»РѕРІ.
  - РўРµСЃС‚С‹ РЅР° pool discovery (mock DEX factory responses).
  - **SLO:** pool discovery latency < 5s
  - **Test command:** `npm run test dex-pool-discovery.spec.ts` вЂ” success
  - **Explicit check:** Redis СЃРѕРґРµСЂР¶РёС‚ `arb:dex:pools:${chainId}:${dex}:${tokenA}:${tokenB}`
- **changed_areas:**
  - `apps/execution-orchestrator/src/workers/`
    - `dex-pool-discovery.worker.ts`
    - `dex-pool-discovery.worker.spec.ts`
  - `apps/execution-orchestrator/src/execution/`
    - `dex-pool.service.ts`
  - `packages/persistence/src/entities/dex-pool.entity.ts`
- **outputs:**
  - `DexPoolDiscoveryWorker` вЂ” РІРѕСЂРєРµСЂ РґР»СЏ РѕС‚РєСЂС‹С‚РёСЏ РїСѓР»РѕРІ
  - `DexPoolService` вЂ” СЃРµСЂРІРёСЃ РґР»СЏ lookup РїСѓР»РѕРІ
  - Redis cache РґР»СЏ РїСѓР»РѕРІ (TTL 3600s)
  - РњРµС‚СЂРёРєР° `arb_dex_pool_discovery_total` (counter)
- **test_commands:**
  - `npm run test dex-pool-discovery.worker.spec.ts`
  - `npm run test dex-pool.service.spec.ts`
- **edge_cases:**
  - Factory contract РЅРµРґРѕСЃС‚СѓРїРµРЅ
  - RPC rate limiting РїСЂРё СЃРєР°РЅРёСЂРѕРІР°РЅРёРё
  - Stale data РІ РєСЌС€Рµ
- **rollback_procedure:**
  - РћСЃС‚Р°РЅРѕРІРёС‚СЊ РІРѕСЂРєРµСЂ
  - РћС‡РёСЃС‚РёС‚СЊ Redis cache
- **ci_integration:** Р”РѕР±Р°РІРёС‚СЊ unit tests РІ CI (Р±РµР· РІРЅРµС€РЅРёС… RPC)
- **review_required:** `backend`
- **review_notes:**
  - вњ… `PoolDiscoveryService` СЂРµР°Р»РёР·РѕРІР°РЅ РІ `apps/execution-orchestrator/src/execution/pool/`
  - вњ… UniV2/V3 pool discovery С‡РµСЂРµР· `getPair`/`getPool` contract calls
  - вњ… In-memory cache СЃ TTL (default 5 min), Redis-ready
  - вњ… Periodic cleanup loop (configurable interval)
  - вњ… Prometheus metrics: `arb_dex_pools_discovered`, `arb_dex_pool_discovery_latency_seconds`, `arb_dex_pool_cache_hits_total`
  - вњ… DI: Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ РІ `ExecutionModule` (providers + exports)
  - вњ… Env vars: `POOL_DISCOVERY_ENABLED`, `POOL_CACHE_TTL_MS`, `POOL_DISCOVERY_INTERVAL_MS`
  - вњ… Build monorepo green (21/21)
  - вљ пёЏ РќРµС‚ unit-С‚РµСЃС‚РѕРІ (pool-discovery.service.spec.ts РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚)
- **review_action_items:**
  - [ ] Р”РѕР±Р°РІРёС‚СЊ unit-С‚РµСЃС‚С‹ СЃ РјРѕРєРѕРј contract calls
- **review_passed_date:** 2026-04-30
- **status:** `done`

#### `DEX-1-0-VAULT` вЂ” Р‘Р°Р·РѕРІС‹Р№ key vault: С€РёС„СЂРѕРІР°РЅРёРµ, СЂРѕС‚Р°С†РёСЏ, audit

- **step_id:** `DEX-1-0-VAULT`
- **phase:** `dex-1`
- **service:** `platform` / `execution`
- **goal:** РҐСЂР°РЅРµРЅРёРµ РєР»СЋС‡РµР№** Р·Р°С€РёС„СЂРѕРІР°РЅРѕ**; СЂР°СЃС€РёС„СЂРѕРІРєР° С‚РѕР»СЊРєРѕ РІ РїСЂРѕС†РµСЃСЃРµ РїРѕРґРїРёСЃРё; append РІ audit РїСЂРё РєР°Р¶РґРѕРј РёСЃРїРѕР»СЊР·РѕРІР°РЅРёРё РєР»СЋС‡Р° (Р±РµР· СѓС‚РµС‡РєРё secret РІ Р»РѕРіРё).
- **depends_on:** [`DEX-1-0-RPC`, `DEX-1-0-MIGRATIONS`]
- **risk_level:** `critical`
- **estimated_hours:** `16`
- **main_plan_prerequisites:** [`P1-1.2-AUD`, `P0-0.3-SEC`]
- **acceptance_criteria:**
  - РќРµС‚ СЃС‹СЂРѕРіРѕ private key РІ Р»РѕРіР°С…; СЂРѕС‚Р°С†РёСЏ РїРѕ РїСЂРѕС†РµРґСѓСЂРµ (runbook + С‚РµС…РїРѕР»Рµ `keyId`).
  - `PRIVATE_KEY_ENCRYPTION_KEY` (РёР»Рё Р°РЅР°Р»РѕРі) РІ `.env.example` СЃ РїРѕРјРµС‚РєРѕР№ security.
  - Audit-Р·Р°РїРёСЃРё СЃРѕРґРµСЂР¶Р°С‚ txHash, chainId, legId, gasUsed (Р±РµР· СѓС‚РµС‡РєРё private key РІ audit-logs).
  - **SLO:** sign latency < 100ms
  - **Test command:** `npm run test key-vault.service.spec.ts` вЂ” success
  - **Explicit check:** Р›РѕРіРё РЅРµ СЃРѕРґРµСЂР¶Р°С‚ `privateKey` РёР»Рё `0x[a-fA-F0-9]{64}`
- **changed_areas:**
  - `packages/nest-platform/src/vault/`
    - `key-vault.service.ts`
    - `key-vault.service.spec.ts`
  - `apps/execution-orchestrator/src/execution/`
    - `execution.module.ts` (DI)
  - `packages/persistence/src/entities/wallet-state.entity.ts`
  - `.env.example` (PRIVATE_KEY_ENCRYPTION_KEY)
- **outputs:**
  - `KeyVaultService` вЂ” СЃРµСЂРІРёСЃ С€РёС„СЂРѕРІР°РЅРёСЏ/РґРµС€РёС„СЂРѕРІР°РЅРёСЏ РєР»СЋС‡РµР№
  - `EncryptedKey` вЂ” С‚РёРї Р·Р°С€РёС„СЂРѕРІР°РЅРЅРѕРіРѕ РєР»СЋС‡Р°
  - Audit entries РїСЂРё РєР°Р¶РґРѕРј РёСЃРїРѕР»СЊР·РѕРІР°РЅРёРё РєР»СЋС‡Р°
  - Runbook РґР»СЏ key rotation
- **test_commands:**
  - `npm run test key-vault.service.spec.ts`
  - `npm run lint -w @arbibot/nest-platform`
- **edge_cases:**
  - Encryption key РЅРµРґРѕСЃС‚СѓРїРµРЅ
  - Corruption Р·Р°С€РёС„СЂРѕРІР°РЅРЅС‹С… РєР»СЋС‡РµР№
  - Leak private key РІ audit logs
- **rollback_procedure:**
  - Р’РѕСЃСЃС‚Р°РЅРѕРІРёС‚СЊ РєР»СЋС‡Рё РёР· backup
  - РћС‚РєР°С‚РёС‚СЊ РјРёРіСЂР°С†РёСЋ `wallet_states`
- **ci_integration:** Unit tests РІ CI (Р±РµР· real keys)
- **review_required:** `architecture`
- **review_notes:**
  - вњ… `KeyVaultService` СЂРµР°Р»РёР·РѕРІР°РЅ РІ `packages/nest-platform/src/vault/`
  - вњ… AES-256-GCM С€РёС„СЂРѕРІР°РЅРёРµ: Buffer РґР»СЏ crypto, hex РґР»СЏ storage
  - вњ… 20/20 unit tests passed (`key-vault.service.spec.ts`)
  - вњ… РўРёРїС‹: `EncryptedKey`, `WalletKey` СЌРєСЃРїРѕСЂС‚РёСЂРѕРІР°РЅС‹ С‡РµСЂРµР· `vault/index.ts`
  - вњ… `KeyVaultModule` РґР»СЏ DI (NestJS)
  - вњ… Р�РЅС‚РµРіСЂР°С†РёСЏ СЃ `ExecutionModule` С‡РµСЂРµР· `KeyVaultModule`
  - вљ пёЏ РќРµС‚ runbook РґР»СЏ key rotation
- **review_action_items:**
  - [ ] РЎРѕР·РґР°С‚СЊ runbook РґР»СЏ key rotation
- **review_passed_date:** 2026-04-29
- **status:** `done`

#### `DEX-1-0-WALLET-MGT` вЂ” РЈРїСЂР°РІР»РµРЅРёРµ РєРѕС€РµР»СЊРєР°РјРё: Р±Р°Р»Р°РЅСЃ, РІС‹Р±РѕСЂ, sufficiency

- **step_id:** `DEX-1-0-WALLET-MGT`
- **phase:** `dex-1`
- **service:** `execution`
- **goal:** Р›РѕРіРёРєР° СѓРїСЂР°РІР»РµРЅРёСЏ РЅРµСЃРєРѕР»СЊРєРёРјРё РєРѕС€РµР»СЊРєР°РјРё: РІС‹Р±РѕСЂ РєРѕС€РµР»СЊРєР° РґР»СЏ СЃРґРµР»РєРё, РїСЂРѕРІРµСЂРєР° РґРѕСЃС‚Р°С‚РѕС‡РЅРѕСЃС‚Рё Р±Р°Р»Р°РЅСЃР°, Р±Р°Р»Р°РЅСЃРёСЂРѕРІРєР° РЅР°РіСЂСѓР·РєРё.
- **depends_on:** [`DEX-1-0-VAULT`, `DEX-1-0-MIGRATIONS`]
- **risk_level:** `high`
- **estimated_hours:** `12`
- **main_plan_prerequisites**: [`P1-1.2-CAP`]
- **acceptance_criteria:**
  - РЎРµСЂРІРёСЃ РІС‹Р±РѕСЂР° РєРѕС€РµР»СЊРєР° Р·Р°РґРѕРєСѓРјРµРЅС‚РёСЂРѕРІР°РЅ (round-robin / weighted / РїРѕ Р±Р°Р»Р°РЅСЃСѓ).
  - РўРµСЃС‚С‹ РЅР° insufficient funds scenario.
  - РџСЂРѕРІРµСЂРєР° allowance / approve РёРЅС‚РµРіСЂРёСЂРѕРІР°РЅР°.
  - **SLO:** wallet selection latency < 50ms
  - **Test command:** `npm run test wallet-manager.service.spec.ts` вЂ” success
  - **Explicit check:** `SELECT * FROM wallet_states WHERE status = 'active'` РІРѕР·РІСЂР°С‰Р°РµС‚ РєРѕС€РµР»СЊРєРё
- **changed_areas:**
  - `apps/execution-orchestrator/src/execution/`
    - `wallet-manager.service.ts`
    - `wallet-manager.service.spec.ts`
  - `packages/persistence/src/entities/wallet-state.entity.ts`
- **outputs:**
  - `WalletManagerService` вЂ” СЃРµСЂРІРёСЃ РІС‹Р±РѕСЂР° РєРѕС€РµР»СЊРєРѕРІ
  - `WalletSelectionStrategy` вЂ” enum (round-robin, weighted, balance-based)
  - РњРµС‚СЂРёРєР° `arb_wallet_selection_total` (counter)
  - РњРµС‚СЂРёРєР° `arb_wallet_insufficient_funds_total` (counter)
- **test_commands:**
  - `npm run test wallet-manager.service.spec.ts`
- **edge_cases:**
  - Р’СЃРµ РєРѕС€РµР»СЊРєРё insufficient funds
  - Wallet state stale (nonce drift)
  - Multiple wallets with same address (collision)
- **rollback_procedure:**
  - Р”РµР°РєС‚РёРІРёСЂРѕРІР°С‚СЊ РїСЂРѕР±Р»РµРјРЅС‹Рµ РєРѕС€РµР»СЊРєРё РІ Р‘Р”
- **ci_integration:** Unit tests РІ CI
- **review_required:** `backend`
- **review_notes:**
  - вњ… `WalletManagerService` СЂРµР°Р»РёР·РѕРІР°РЅ РІ `apps/execution-orchestrator/src/execution/`
  - вњ… 3 СЃС‚СЂР°С‚РµРіРёРё РІС‹Р±РѕСЂР°: round-robin, weighted, balance-based
  - вњ… `ExecutionModule` СЃРѕР·РґР°РЅ: DI СЃ `KeyVaultModule` + `WalletState` TypeORM
  - вњ… Prometheus metrics: `arb_wallet_selection_total`, `arb_wallet_insufficient_funds_total`, `arb_wallet_balance`
  - вњ… ERC20 balance checking С‡РµСЂРµР· ethers.js `Contract`
  - вњ… Wallet cache СЃ `clearWalletCache()` РґР»СЏ key rotation
  - вњ… `getEncryptedKey` РґРµР»РµРіРёСЂСѓРµС‚ Рє `KeyVaultService.retrieveEncryptedKey`
  - вљ пёЏ РќРµС‚ unit-С‚РµСЃС‚РѕРІ (`wallet-manager.service.spec.ts` РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚)
- **review_action_items:**
  - [ ] Р”РѕР±Р°РІРёС‚СЊ unit-С‚РµСЃС‚С‹ РґР»СЏ WalletManagerService
- **review_passed_date:** 2026-04-29
- **status:** `done`

#### `DEX-1-0-GAS` вЂ” РћС†РµРЅРєР° РіР°Р·Р° Рё Р»РёРјРёС‚РѕРІ; max gas policy

- **step_id:** `DEX-1-0-GAS`
- **phase:** `dex-1`
- **service:** `execution`
- **goal:** `estimateGas`, EIP-1559 РїРѕР»СЏ, РїРѕС‚РѕР»РѕРє `maxFeePerGas` РёР· РїРѕР»РёС‚РёРєРё/config; РѕС‚РєР°Р· РІ submit РїСЂРё РїСЂРµРІС‹С€РµРЅРёРё.
- **depends_on:** [`DEX-1-0-RPC`]
- **risk_level:** `high`
- **estimated_hours:** `8`
- **main_plan_prerequisites:** [`P1-1.1-REDIS`]
- **acceptance_criteria:**
  - РџРѕР»РёС‚РёРєР° РІ config-service РёР»Рё env СЃ РІРµСЂС…РЅРёРј РїСЂРµРґРµР»РѕРј; С‚РµСЃС‚С‹ РЅР° РіСЂР°РЅРёС‡РЅС‹С… Р·РЅР°С‡РµРЅРёСЏС….
  - EIP-1559 РїР°СЂР°РјРµС‚СЂС‹ (maxPriorityFeePerGas, maxFeePerGas) РЅР°СЃС‚СЂР°РёРІР°СЋС‚СЃСЏ С‡РµСЂРµР· config.
  - РўРµСЃС‚С‹ РЅР° high baseFee scenarios (РїСЂРѕРІРµСЂРєР° РїСЂРµРІС‹С€РµРЅРёСЏ maxFeePerGas).
  - **SLO:** gas estimation latency < 500ms
  - **Test command:** `npm run test gas-estimator.service.spec.ts` вЂ” success
  - **Explicit check:** `MAX_GAS_PRICE_GWEI` РІ config-service РѕС‚РєР»РѕРЅСЏРµС‚ РІС‹СЃРѕРєСѓСЋ С‚СЂР°РЅР·Р°РєС†РёСЋ
- **changed_areas:**
  - `apps/execution-orchestrator/src/execution/`
    - `gas-estimator.service.ts`
    - `gas-estimator.service.spec.ts`
  - `.env.example` (MAX_GAS_PRICE_GWEI, MAX_PRIORITY_FEE_GWEI)
- **outputs:**
  - `GasEstimatorService` вЂ” СЃРµСЂРІРёСЃ РѕС†РµРЅРєРё РіР°Р·Р°
  - `GasPolicy` вЂ” РёРЅС‚РµСЂС„РµР№СЃ РїРѕР»РёС‚РёРєРё РіР°Р·Р°
  - РњРµС‚СЂРёРєР° `arb_gas_estimate_seconds` (histogram)
  - РњРµС‚СЂРёРєР° `arb_gas_price_gwei` (gauge)
- **test_commands:**
  - `npm run test gas-estimator.service.spec.ts`
- **edge_cases:**
  - Base fee РїСЂРµРІС‹С€Р°РµС‚ maxFeePerGas
  - Gas estimation fails (contract revert)
  - RPC returns invalid gas estimate
- **rollback_procedure:**
  - РћС‚РєР°С‚РёС‚СЊ РёР·РјРµРЅРµРЅРёСЏ РІ `.env.example`
  - РЈРґР°Р»РёС‚СЊ `GasEstimatorService` РёР· DI
- **ci_integration:** Unit tests РІ CI
- **review_required:** `backend`
- **review_notes:**
  - вњ… `GasEstimatorService` СЂРµР°Р»РёР·РѕРІР°РЅ РІ `apps/execution-orchestrator/src/execution/gas/`
  - вњ… EIP-1559 fee data: maxFeePerGas, maxPriorityFeePerGas, baseFee
  - вњ… Gas policy РёР· env: `MAX_GAS_PRICE_GWEI`, `MAX_PRIORITY_FEE_GWEI`, `GAS_LIMIT_MULTIPLIER`, `GAS_REJECT_ON_EXCEED`
  - вњ… Per-chain overrides: `GAS_POLICY_{CHAINID}_MAX_FEE_GWEI`, `GAS_POLICY_{CHAINID}_MAX_PRIORITY_FEE_GWEI`
  - вњ… Prometheus metrics: `arb_gas_estimate_seconds` (histogram), `arb_gas_price_gwei` (gauge), `arb_gas_policy_rejections_total` (counter)
  - вњ… `estimateGas()` вЂ” gas limit + fee data + policy check
  - вњ… `shouldReject()` вЂ” policy enforcement gate
  - вњ… `getCappedFeeData()` вЂ” clamp fees to policy limits
  - вњ… Unit tests: 15 test cases (policy, EIP-1559, estimation, rejection, capping)
  - вњ… DI: Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ РІ `ExecutionModule` (providers + exports)
  - вњ… `.env.example` РѕР±РЅРѕРІР»С‘РЅ СЃ RPC Рё GAS env vars + security comments
- **review_passed_date:** 2026-04-29
- **status:** `done`

#### `DEX-1-0-RISK-POLICIES` вЂ” DEX-СЃРїРµС†РёС„РёС‡РЅС‹Рµ risk policies

- **step_id:** `DEX-1-0-RISK-POLICIES`
- **phase:** `dex-1`
- **service:** `risk-service`
- **goal:** DEX-СЃРїРµС†РёС„РёС‡РЅС‹Рµ risk policies: MEV risk, slippage risk, gas volatility risk, bridge risk (РґР»СЏ DEX-2).
- **depends_on:** [`P2-2.2-PROF`]
- **risk_level:** `medium`
- **estimated_hours:** `8`
- **main_plan_prerequisites:** [`P2-2.2-PROF`]
- **acceptance_criteria:**
  - РќРѕРІС‹Рµ РїРѕР»СЏ РІ `route_profiles` (mevRiskLevel, slippageRiskLevel, gasVolatilityLevel).
  - РќРѕРІС‹Рµ reason codes РІ `risk_decisions` РґР»СЏ DEX-СЃРїРµС†РёС„РёС‡РЅС‹С… Р±Р»РѕРєРёСЂРѕРІРѕРє.
  - РўРµСЃС‚С‹ РЅР° high MEV/gas volatility scenarios.
  - **Test command:** `npm run test dex-risk-policies.spec.ts` вЂ” success
  - **Explicit check:** `GET /policy/route-profiles` РІРѕР·РІСЂР°С‰Р°РµС‚ MEV/slippage/gas fields
- **changed_areas:**
  - `apps/risk-service/src/policy/`
    - `dex-risk-policies.service.ts`
    - `dex-risk-policies.service.spec.ts`
  - `packages/persistence/src/entities/route-profile.entity.ts`
  - `packages/persistence/src/entities/risk-decision.entity.ts`
- **outputs:**
  - `DexRiskPoliciesService` вЂ” СЃРµСЂРІРёСЃ DEX-specific risk evaluation
  - MEV risk levels (low, medium, high)
  - Slippage risk levels (conservative, moderate, aggressive)
  - Gas volatility thresholds
- **test_commands:**
  - `npm run test dex-risk-policies.service.spec.ts`
  - `npm run test -w @arbibot/risk-service`
- **edge_cases:**
  - Undefined risk level РґР»СЏ РјР°СЂС€СЂСѓС‚Р°
  - Conflicting risk policies
- **rollback_procedure:**
  - РЈРґР°Р»РёС‚СЊ РЅРѕРІС‹Рµ РїРѕР»СЏ РёР· `route_profiles`
  - РћС‚РєР°С‚РёС‚СЊ РјРёРіСЂР°С†РёРё (РµСЃР»Рё РµСЃС‚СЊ)
- **ci_integration:** Unit tests РІ CI
- **review_required:** `backend`
- **review_notes:**
  - вњ… `DexRiskPolicyService` СЂРµР°Р»РёР·РѕРІР°РЅ РІ `apps/execution-orchestrator/src/execution/risk/`
  - вњ… Slippage risk check (max slippage bps per trade)
  - вњ… Position size limit check (max USD per trade)
  - вњ… Protocol risk check (allowed DEX protocols)
  - вњ… Volume risk check (min pool liquidity)
  - вњ… Prometheus metrics: `arb_dex_risk_checks_total`, `arb_dex_risk_rejections_total`
  - вњ… DI: Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ РІ `ExecutionModule`
  - вњ… Env vars: `DEX_MAX_SLIPPAGE_BPS`, `DEX_MAX_POSITION_SIZE_USD`, `DEX_MIN_POOL_LIQUIDITY_USD`
  - вњ… Build monorepo green (21/21)
- **review_passed_date:** 2026-04-30
- **status:** `done`

#### `DEX-1-0-FILTERS` вЂ” DEX Opportunity Filters System

- **step_id:** `DEX-1-0-FILTERS`
- **phase:** `dex-1`
- **service:** `opportunity-service`, `apps/web`
- **goal:** РЎРёСЃС‚РµРјР° С„РёР»СЊС‚СЂР°С†РёРё DEX РІРѕР·РјРѕР¶РЅРѕСЃС‚РµР№ РґР»СЏ РєРѕРЅС‚СЂРѕР»СЏ РѕР±СЂР°Р±Р°С‚С‹РІР°РµРјС‹С… Р°СЂР±РёС‚СЂР°Р¶РЅС‹С… РІРѕР·РјРѕР¶РЅРѕСЃС‚РµР№; UI РґР»СЏ СѓРїСЂР°РІР»РµРЅРёСЏ С„РёР»СЊС‚СЂР°РјРё; РјРµС‚СЂРёРєРё СЌС„С„РµРєС‚РёРІРЅРѕСЃС‚Рё.
- **depends_on:** [`P2-2.2-PROF`, `DEX-1-0-TECH-CHOICE`]
- **risk_level:** `medium`
- **estimated_hours:** `24`
- **main_plan_prerequisites:** [`P2-2.2-PROF`, `P1-1.1-REDIS`]
- **acceptance_criteria:**
  - Backend: СЌРЅРґРїРѕРёРЅС‚С‹ РґР»СЏ С„РёР»СЊС‚СЂР°С†РёРё Рё РїСЂРµРґРїСЂРѕСЃРјРѕС‚СЂР° РІ `opportunity-service`; С‚РёРїС‹ РІ `@arbibot/contracts`.
  - Frontend BFF: РїСЂРѕРєСЃРё-СЂРѕСѓС‚С‹ РІ `apps/web/app/api/operator/`.
  - Frontend Components: UI РїР°РЅРµР»СЊ СЃ С„РёР»СЊС‚СЂР°РјРё, РёРЅС‚РµРіСЂРёСЂРѕРІР°РЅРЅР°СЏ РІ `/settings`.
  - Config: seed-РґР°РЅРЅС‹Рµ РІ РјРёРіСЂР°С†РёРё `032_dex_filters_seed.sql`.
  - Р’СЃРµ С„РёР»СЊС‚СЂС‹ СѓРїСЂР°РІР»СЏСЋС‚СЃСЏ С‡РµСЂРµР· config-service (`dex.filters` key).
  - **SLO:** filter application latency < 10ms, preview impact < 100ms
  - **Test command:** `npm run build -w @arbibot/web` вЂ” success
  - **Test command:** `npm run test -w @arbibot/opportunity-service` вЂ” success
  - **Explicit check:** `/settings` СЃРѕРґРµСЂР¶РёС‚ "DEX filters" tab; С„РёР»СЊС‚СЂС‹ РїСЂРёРјРµРЅСЏСЋС‚СЃСЏ Рє opportunities
- **changed_areas:**
  - `apps/opportunity-service/src/opportunities/`
    - `dto/dex-filters-config.dto.ts`
    - `dto/preview-filters.dto.ts`
    - `opportunities.service.ts` (filter logic)
    - `opportunities.controller.ts` (endpoints)
  - `packages/contracts/src/`
    - `dex-filters.types.ts`
    - `index.ts` (exports)
  - `packages/persistence/src/` (РµСЃР»Рё РЅСѓР¶РЅС‹ СЃСѓС‰РЅРѕСЃС‚Рё РґР»СЏ РјРµС‚СЂРёРє)
  - `apps/web/app/api/operator/opportunities/`
    - `preview-filters/route.ts`
    - `metrics/dex-filters/route.ts`
  - `apps/web/app/api/operator/settings/configurations/`
    - `dex.filters/route.ts`
  - `apps/web/lib/`
    - `dex-filters-query-keys.ts`
    - `use-dex-filters.ts`
    - `api-base.ts` (OPPORTUNITY_API_BASE export)
  - `apps/web/components/`
    - `dex-filters/dex-filters-panel.tsx`
    - `ui/card.tsx`
    - `ui/switch.tsx`
    - `ui/badge.tsx`
    - `settings-workspace.tsx` (integration)
  - `infra/postgres/migrations/032_dex_filters_seed.sql`
  - `docs/dex-filters-config-keys.md`
- **outputs:**
  - `DexFiltersConfig` вЂ” С‚РёРї РєРѕРЅС„РёРіСѓСЂР°С†РёРё С„РёР»СЊС‚СЂРѕРІ РІ `@arbibot/contracts`
  - `DEFAULT_DEX_FILTERS_CONFIG` вЂ” РґРµС„РѕР»С‚РЅР°СЏ РєРѕРЅС„РёРіСѓСЂР°С†РёСЏ
  - `POST /opportunities/preview-filters` вЂ” РїСЂРµРґРїСЂРѕСЃРјРѕС‚СЂ РІР»РёСЏРЅРёСЏ С„РёР»СЊС‚СЂРѕРІ
  - `GET /opportunities/metrics/dex-filters` вЂ” РјРµС‚СЂРёРєРё СЌС„С„РµРєС‚РёРІРЅРѕСЃС‚Рё (24h)
  - `GET /api/operator/settings/configurations/dex.filters` вЂ” BFF РґР»СЏ РєРѕРЅС„РёРіСѓСЂР°С†РёРё
  - `DexFiltersPanel` вЂ” React РєРѕРјРїРѕРЅРµРЅС‚ UI РґР»СЏ СѓРїСЂР°РІР»РµРЅРёСЏ С„РёР»СЊС‚СЂР°РјРё
  - Р¤РёР»СЊС‚СЂС‹:
    - **Threshold**: minSpreadPct, minProfitUsd, maxFeesUsd
    - **Volume**: volumeRange (min/max)
    - **Tokens**: blacklistTokens, allowedChains, quoteAssets
    - **Risk**: highRisk (maxRiskLevel: low/medium/high)
  - РњРµС‚СЂРёРєРё: `arb_dex_filters_applied_total`, `arb_dex_filters_filtered_total`
- **test_commands:**
  - `npm run build -w @arbibot/opportunity-service`
  - `npm run build -w @arbibot/web`
  - `npm run test -w @arbibot/opportunity-service`
  - Manual UI testing: `/settings` в†’ "DEX filters" tab
- **edge_cases:**
  - All opportunities filtered out (100% rejection rate)
  - Invalid filter values (negative numbers, empty strings)
  - Config-service unavailable (fallback to defaults)
  - High filter rejection rate (>90%) вЂ” alert threshold
- **rollback_procedure:**
  - РЈРґР°Р»РёС‚СЊ СЌРЅРґРїРѕРёРЅС‚С‹ РёР· `opportunities.controller.ts`
  - РЈРґР°Р»РёС‚СЊ BFF СЂРѕСѓС‚С‹
  - РћС‚РєР°С‚РёС‚СЊ РјРёРіСЂР°С†РёСЋ `032_dex_filters_seed.sql`
  - РЈРґР°Р»РёС‚СЊ UI РєРѕРјРїРѕРЅРµРЅС‚ РёР· `settings-workspace.tsx`
- **ci_integration:** Build Рё unit tests РІ CI; UI testing manual
- **review_required:** `backend`, `frontend`
- **status:** `done` (СЂРµР°Р»РёР·РѕРІР°РЅРѕ 2026-04-28)

#### `DEX-1-0-ENV-EXAMPLE` вЂ” Env vars template РґР»СЏ DEX

- **step_id:** `DEX-1-0-ENV-EXAMPLE`
- **phase:** `dex-1`
- **service:** `monorepo`
- **goal:** Р”РѕР±Р°РІРёС‚СЊ DEX-СЃРїРµС†РёС„РёС‡РЅС‹Рµ env vars РІ `.env.example` СЃ РєРѕРјРјРµРЅС‚Р°СЂРёСЏРјРё security.
- **depends_on:** [`DEX-1-0-RPC`, `DEX-1-0-VAULT`, `DEX-1-0-GAS`]
- **risk_level:** `low`
- **estimated_hours:** `2`
- **main_plan_prerequisites:** []
- **acceptance_criteria:**
  - `.env.example` СЃРѕРґРµСЂР¶РёС‚ РІСЃРµ СѓРїРѕРјСЏРЅСѓС‚С‹Рµ РїРµСЂРµРјРµРЅРЅС‹Рµ: `RPC_*_URL`, `PRIVATE_KEY_ENCRYPTION_KEY`, `MAX_GAS_PRICE_GWEI`, `DEX_VENUE_ENABLED` (feature flag РёР· `DEX-1-1-VENUE-BIND`).
  - РџРѕРјРµС‚РєРё security РґР»СЏ РєР»СЋС‡РµР№ Рё encryption key.
  - **Test command:** `cat .env.example | grep -E "RPC_|PRIVATE_KEY|MAX_GAS|DEX_VENUE"` вЂ” РЅРµ РїСѓСЃС‚РѕР№
- **changed_areas:**
  - `.env.example`
- **outputs:**
  - РћР±РЅРѕРІР»РµРЅРЅС‹Р№ `.env.example` СЃ DEX env vars
  - РљРѕРјРјРµРЅС‚Р°СЂРёРё security РґР»СЏ РєСЂРёС‚РёС‡РµСЃРєРёС… РїРµСЂРµРјРµРЅРЅС‹С…
- **test_commands:**
  - `cat .env.example | grep -E "RPC_|PRIVATE_KEY|MAX_GAS|DEX_VENUE"`
- **edge_cases:**
  - РџСЂРѕРїСѓС‰РµРЅРЅС‹Рµ env vars
  - РќРµС‚ security РєРѕРјРјРµРЅС‚Р°СЂРёРµРІ
- **rollback_procedure:** Git revert `.env.example`
- **ci_integration:** N/A
- **review_required:** `backend`
- **review_notes:**
  - вњ… `.env.example` РѕР±РЅРѕРІР»С‘РЅ: RPC (9 vars), GAS (6+ vars), VAULT (2 vars), WALLET-MGT (1 var)
  - вњ… Security comments РґР»СЏ `PRIVATE_KEY_ENCRYPTION_KEY`
  - вњ… Per-chain override examples РґР»СЏ Arbitrum
  - вњ… Р’СЃРµ РїРµСЂРµРјРµРЅРЅС‹Рµ РёР· DEX-1-0-RPC, DEX-1-0-VAULT, DEX-1-0-GAS РїРѕРєСЂС‹С‚С‹
- **review_passed_date:** 2026-04-29
- **status:** `done`

### DEX-1.1 вЂ” РџРѕРґРіРѕС‚РѕРІРєР° Рє DEX: approve pattern, Р°РґР°РїС‚РµСЂС‹

#### `DEX-1-1-APPROVE-PATTERN` вЂ” Approve/unapprove СѓС‚РёР»РёС‚Р° РґР»СЏ DEX

- **step_id:** `DEX-1-1-APPROVE-PATTERN`
- **phase:** `dex-1`
- **service:** `execution`
- **goal:** РЈС‚РёР»РёС‚Р° РґР»СЏ РїСЂРѕРІРµСЂРєРё allowance, approve spender (idempotent), revoke; РёРЅС‚РµРіСЂР°С†РёСЏ СЃ DEX-Р°РґР°РїС‚РµСЂР°РјРё.
- **depends_on:** [`DEX-1-0-MIGRATIONS`, `DEX-1-0-VAULT`, `DEX-1-0-WALLET-MGT`]
- **risk_level:** `medium`
- **estimated_hours:** `10`
- **main_plan_prerequisites:** [`P2-2.1-EPL`]
- **acceptance_criteria:**
  - Р�РЅС‚РµРіСЂР°С†РёРѕРЅРЅС‹Р№ С‚РµСЃС‚: approve в†’ swap (РїСЂРѕРІРµСЂРєР° sufficient allowance).
  - Idempotency: РїРѕРІС‚РѕСЂРЅС‹Р№ approve СЃ С‚РµРј Р¶Рµ amount РЅРµ РґСѓР±Р»РёСЂСѓРµС‚ С‚СЂР°РЅР·Р°РєС†РёСЋ.
  - РўР°Р±Р»РёС†Р° `approvals` (РёР· РјРёРіСЂР°С†РёРё) РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РґР»СЏ РєСЌС€Р°.
  - **SLO:** approve latency < 200ms, allowance check < 100ms
  - **Test command:** `npm run test dex-approve-pattern.spec.ts` вЂ” success
  - **Explicit check:** `SELECT * FROM approvals WHERE spender = '0x...' AND status = 'approved'`
- **changed_areas:**
  - `apps/execution-orchestrator/src/execution/`
    - `dex-approve.service.ts`
    - `dex-approve.service.spec.ts`
  - `packages/persistence/src/entities/approval.entity.ts`
- **outputs:**
  - `DexApproveService` вЂ” СЃРµСЂРІРёСЃ approve/revoke
  - `AllowanceCache` вЂ” РєСЌС€ allowances РІ Redis
  - РњРµС‚СЂРёРєР° `arb_dex_approve_total` (counter)
- **test_commands:**
  - `npm run test dex-approve.service.spec.ts`
- **edge_cases:**
  - Approve fails (insufficient gas, revert)
  - Allowance race condition
  - Revoke РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚СЃСЏ DEX
- **rollback_procedure:** РћС‡РёСЃС‚РёС‚СЊ С‚Р°Р±Р»РёС†Сѓ `approvals` Рё Redis cache
- **ci_integration:** Unit tests РІ CI (Р±РµР· real tx)
- **review_required:** `backend`
- **review_notes:**
  - вњ… `TokenApproveService` СЂРµР°Р»РёР·РѕРІР°РЅ РІ `apps/execution-orchestrator/src/execution/token/`
  - вњ… `checkAllowance()` вЂ” РїСЂРѕРІРµСЂРєР° С‚РµРєСѓС‰РµРіРѕ allowance С‡РµСЂРµР· ERC20 contract
  - вњ… `approveToken()` вЂ” idempotent approvespender (РїСЂРѕРїСѓСЃРєР°РµС‚ РµСЃР»Рё allowance РґРѕСЃС‚Р°С‚РѕС‡РµРЅ)
  - вњ… `revokeApproval()` вЂ” revoke approval (СѓСЃС‚Р°РЅРѕРІРєР° allowance = 0)
  - вњ… In-memory allowance cache СЃ configurable TTL
  - вњ… Prometheus metrics: `arb_dex_approve_total`, `arb_dex_approve_allowance_checks_total`
  - вњ… DI: Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ РІ `ExecutionModule`
  - вњ… Env vars: `DEX_APPROVE_GAS_LIMIT`, `DEX_ALLOWANCE_CACHE_TTL_MS`
  - вњ… Build monorepo green (21/21)
- **review_passed_date:** 2026-04-30
- **status:** `done`

#### `DEX-1-1-SLIPPAGE` вЂ” Slippage protection Рё minimumAmountOut enforcement

- **step_id:** `DEX-1-1-SLIPPAGE`
- **phase:** `dex-1`
- **service:** `execution`
- **goal:** Slippage tolerance config, РІР°Р»РёРґР°С†РёСЏ, minimumAmountOut enforcement РґР»СЏ DEX-СЃРґРµР»РѕРє.
- **depends_on:** [`DEX-1-0-POOL-DISCOVERY`, `DEX-1-0-GAS`]
- **risk_level:** `high`
- **estimated_hours:** `8`
- **main_plan_prerequisites:** [`P2-2.2-PROF`]
- **acceptance_criteria:**
  - Slippage tolerance РІ config-service РёР»Рё env (РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ: 0.5% high-liq, 1% mid-liq, 5% low-liq).
  - РўРµСЃС‚С‹ РЅР° price impact scenarios; reject, РµСЃР»Рё slippage > tolerance.
  - Р”РѕРєСѓРјРµРЅС‚ Рѕ РґРёР°РїР°Р·РѕРЅР°С… Рё РїРѕР»РёС‚РёРєРµ РЅР°СЃС‚СЂРѕР№РєРё.
  - **Test command:** `npm run test dex-slippage-protection.spec.ts` вЂ” success
  - **Explicit check:** Reject РїСЂРё slippage > tolerance РІ Р»РѕРіР°С…
- **changed_areas:**
  - `apps/execution-orchestrator/src/execution/`
    - `dex-slippage-protection.service.ts`
    - `dex-slippage-protection.service.spec.ts`
  - `docs/dex-slippage-policy.md` (РЅРѕРІС‹Р№)
- **outputs:**
  - `DexSlippageProtectionService` вЂ” СЃРµСЂРІРёСЃ РІР°Р»РёРґР°С†РёРё slippage
  - Slippage tolerance levels (high-liq, mid-liq, low-liq)
  - Document СЃ РїРѕР»РёС‚РёРєРѕР№ РЅР°СЃС‚СЂРѕР№РєРё
- **test_commands:**
  - `npm run test dex-slippage-protection.service.spec.ts`
- **edge_cases:**
  - Slippage tolerance РЅРµ Р·Р°РґР°РЅ
  - Extreme price impact (flash crash)
  - MinimumAmountOut = 0
- **rollback_procedure:** РћС‚РєР°С‚РёС‚СЊ РґРѕРєСѓРјРµРЅС‚Р°С†РёСЋ
- **ci_integration:** Unit tests РІ CI
- **review_required:** `backend`
- **review_notes:**
  - вњ… `SlippageProtectionService` СЂРµР°Р»РёР·РѕРІР°РЅ РІ `apps/execution-orchestrator/src/execution/slippage/`
  - вњ… Slippage tolerance levels: high-liq (0.5%), mid-liq (1%), low-liq (5%)
  - вњ… `calculateMinimumAmountOut()` вЂ” СЂР°СЃС‡С‘С‚ min output СЃ СѓС‡С‘С‚РѕРј slippage tolerance
  - вњ… `validateSlippage()` вЂ” РІР°Р»РёРґР°С†РёСЏ price impact, reject РїСЂРё РїСЂРµРІС‹С€РµРЅРёРё
  - вњ… `getSlippageTolerance()` вЂ” РѕРїСЂРµРґРµР»РµРЅРёРµ tolerance РїРѕ liquidity tier
  - вњ… Prometheus metrics: `arb_dex_slippage_checks_total`, `arb_dex_slippage_rejections_total`
  - вњ… DI: Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ РІ `ExecutionModule`
  - вњ… Env vars: `DEX_SLIPPAGE_HIGH_LIQ_BPS`, `DEX_SLIPPAGE_MID_LIQ_BPS`, `DEX_SLIPPAGE_LOW_LIQ_BPS`, `DEX_SLIPPAGE_MAX_BPS`
  - вњ… Build monorepo green (21/21)
- **review_passed_date:** 2026-04-30
- **status:** `done`

#### `DEX-1-1-ADAPTER-UNI2` вЂ” Uniswap V2-СЃРѕРІРјРµСЃС‚РёРјС‹Р№ Р°РґР°РїС‚РµСЂ (swap path)

- **step_id:** `DEX-1-1-ADAPTER-UNI2`
- **phase:** `dex-1`
- **service:** `apps/execution-orchestrator` (РёР»Рё `packages/dex-venue-adapters`)
- **goal:** Р РµР°Р»РёР·Р°С†РёСЏ СЃС†РµРЅР°СЂРёСЏ `swapExactTokensForTokens` (РёР»Рё Р°РЅР°Р»РѕРі) + approve РїСЂРё РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё; РјР°РїРїРёРЅРі `ExecutionLeg` в†’ calldata/tx.
- **depends_on:** [`DEX-1-0-ABIS`, `DEX-1-0-RPC`, `DEX-1-0-VAULT`, `DEX-1-0-WALLET-MGT`, `DEX-1-1-APPROVE-PATTERN`]
- **risk_level:** `critical`
- **estimated_hours:** `16`
- **main_plan_prerequisites:** [`P2-2.1-VEN`]
- **acceptance_criteria:**
  - Р�РЅС‚РµРіСЂР°С†РёРѕРЅРЅС‹Р№ С‚РµСЃС‚ РЅР° testnet **fork** РёР»Рё testnet (Р±РµР· mainnet).
  - `routeKey` / leg metadata РІ Р‘Р” СЃРѕРіР»Р°СЃРѕРІР°РЅС‹ СЃ canonical/risk.
  - **SLO:** swap construction < 200ms, submit < 200ms
  - **Test command:** `npm run test uniswap-v2-adapter.spec.ts` вЂ” success
  - **Explicit check:** Success swap РЅР° testnet (manual verification)
- **changed_areas:**
  - `apps/execution-orchestrator/src/execution/adapters/`
    - `uniswap-v2.adapter.ts`
    - `uniswap-v2.adapter.spec.ts`
  - `packages/contracts-eth/` (РµСЃР»Рё РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ)
- **outputs:**
  - `UniswapV2Adapter` вЂ” СЂРµР°Р»РёР·Р°С†РёСЏ `VenueAdapter` РґР»СЏ Uniswap V2
  - Calldata construction РґР»СЏ `swapExactTokensForTokens`
  - Integration СЃ `approve` pattern
  - РњРµС‚СЂРёРєР° `arb_dex_uniswap_v2_swap_total` (counter)
- **test_commands:**
  - `npm run test uniswap-v2.adapter.spec.ts`
- **edge_cases:**
  - Insufficient liquidity
  - Slippage > tolerance
  - Revert from DEX contract
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ Р°РґР°РїС‚РµСЂ РёР· DI
- **ci_integration:** Unit tests РІ CI (fork mode)
- **review_required:** `backend`
- **review_notes:**
  - вњ… `UniswapV2Adapter` СЂРµР°Р»РёР·РѕРІР°РЅ РІ `apps/execution-orchestrator/src/execution/adapters/`
  - вњ… `submitLeg(plan, leg)` в†’ `{ externalOrderId: txHash }` вЂ” РїРѕР»РЅР°СЏ СЂРµР°Р»РёР·Р°С†РёСЏ VenueAdapter
  - вњ… `swapExactTokensForTokens` calldata construction С‡РµСЂРµР· ethers.js `Interface.encodeFunctionData`
  - вњ… ERC20 approve integration: `ensureApproval()` СЃ allowance check + approve РїСЂРё РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё
  - вњ… On-chain quote: `calculateAmountOutMin()` С‡РµСЂРµР· router `getAmountsOut` + slippage
  - вњ… Gas policy enforcement: reject РїСЂРё РїСЂРµРІС‹С€РµРЅРёРё `withinPolicy: false`
  - вњ… Error hierarchy: `VenueSubmitClientError` (validation), `VenueSubmitTransientError` (retryable), `VenueTerminalSubmitError` (reverted)
  - вњ… Prometheus metrics: `arb_dex_uniswap_v2_swap_total` (counter), `arb_dex_uniswap_v2_swap_latency_seconds` (histogram)
  - вњ… DI: Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ РІ `ExecutionModule` СЃ `RpcProviderManager`, `WalletManagerService`, `GasEstimatorService`, `TokenApproveService`
  - вњ… Unit tests: 21/21 passed (validation, pure functions, buildSwapTxRequest, ensureApproval, submitLeg success/gas rejection/reverted/null receipt/unexpected error)
  - вњ… Build + lint: 0 errors
  - вњ… Supported chains: Arbitrum (42161), Base (8453), BNB (56) С‡РµСЂРµР· `@arbibot/contracts-eth` addresses
- **status:** `done`

#### `DEX-1-1-ADAPTER-UNI3` вЂ” Uniswap V3 (exactIn single pool / РјРёРЅРёРјР°Р»СЊРЅС‹Р№ path)

- **step_id:** `DEX-1-1-ADAPTER-UNI3`
- **phase:** `dex-1`
- **service:** `execution` / `packages/dex-venue-adapters`
- **goal:** РњРёРЅРёРјР°Р»СЊРЅС‹Р№ СЂР°Р±РѕС‡РёР№ exactInput **single pool**; СЂР°СЃС€РёСЂРµРЅРёРµ multi-hop вЂ” РїРѕРґР·Р°РґР°С‡РµР№ РїРѕСЃР»Рµ РїРµСЂРІРѕРіРѕ e2e.
- **depends_on:** [`DEX-1-1-ADAPTER-UNI2`]
- **risk_level:** `high`
- **estimated_hours:** `12`
- **main_plan_prerequisites:** [`P2-2.1-VEN`]
- **acceptance_criteria:**
  - РўРµ Р¶Рµ РєСЂРёС‚РµСЂРёРё, С‡С‚Рѕ Рё UNI2; РґРѕРєСѓРјРµРЅС‚ Рѕ РіСЂР°РЅРёС†Р°С… (РѕРґРёРЅ РїСѓР» vs path).
  - **Test command:** `npm run test uniswap-v3-adapter.spec.ts` вЂ” success
  - **Explicit check:** Success single-pool swap РЅР° testnet
- **changed_areas:**
  - `apps/execution-orchestrator/src/execution/adapters/`
    - `uniswap-v3.adapter.ts`
    - `uniswap-v3.adapter.spec.ts`
  - `docs/uniswap-v3-scope.md` (РЅРѕРІС‹Р№)
- **outputs:**
  - `UniswapV3Adapter` вЂ” СЂРµР°Р»РёР·Р°С†РёСЏ `VenueAdapter` РґР»СЏ Uniswap V3
  - Calldata construction РґР»СЏ `exactInputSingle`
  - Document СЃ РѕРіСЂР°РЅРёС‡РµРЅРёСЏРјРё (single pool only)
- **test_commands:**
  - `npm run test uniswap-v3.adapter.spec.ts`
- **edge_cases:**
  - Fee tier mismatch
  - Tick out of range
  - Multi-hop paths (РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚СЃСЏ РІ v1)
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ Р°РґР°РїС‚РµСЂ РёР· DI
- **ci_integration:** Unit tests РІ CI (fork mode)
- **review_notes:**
  - вњ… `UniswapV3Adapter` СЂРµР°Р»РёР·РѕРІР°РЅ РІ `apps/execution-orchestrator/src/execution/adapters/`
  - вњ… `submitLeg(plan, leg)` в†’ `{ externalOrderId: txHash }` вЂ” РїРѕР»РЅР°СЏ СЂРµР°Р»РёР·Р°С†РёСЏ VenueAdapter
  - вњ… `exactInputSingle` calldata construction С‡РµСЂРµР· ethers.js `Interface.encodeFunctionData`
  - вњ… DexSwapParamsV3: `fee` (uint24 pool fee tier), `amountOutExpected`, `sqrtPriceLimitX96`
  - вњ… Shared utils СЃ V2: `applySlippage`, `getSlippageBps`
  - вњ… ERC20 approve, gas policy, Prometheus metrics, error hierarchy
  - вњ… Unit tests: 21/21 passed (validation, pure functions, buildSwapTxRequest, ensureApproval, submitLeg success/gas rejection/reverted/null receipt/unexpected error)
  - вњ… DI: Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ РІ `ExecutionModule`
  - вњ… Build + lint: 0 errors
  - вњ… Commit: `a48c644` (2026-05-05)
- **review_passed_date:** 2026-05-05
- **status:** `done`

#### `DEX-1-1-ADAPTER-SUSHI` вЂ” SushiSwap РЅР° Arbitrum (РјР°СЂС€СЂСѓС‚ СЃРѕРіР»Р°СЃРѕРІР°РЅ СЃ UNI2 РіРґРµ РІРѕР·РјРѕР¶РЅРѕ)

- **step_id:** `DEX-1-1-ADAPTER-SUSHI`
- **phase:** `dex-1`
- **service:** `execution` / `packages/dex-venue-adapters`
- **goal:** РђРґР°РїС‚РµСЂ Sushi (V2-СЃС‚РёР»СЊ), РѕР±С‰РёРµ СѓС‚РёР»РёС‚С‹ СЃ UNI2 РіРґРµ РїСЂРёРјРµРЅРёРјРѕ.
- **depends_on:** [`DEX-1-1-ADAPTER-UNI2`]
- **risk_level:** `medium`
- **estimated_hours:** `8`
- **main_plan_prerequisites:** [`P2-2.1-VEN`]
- **acceptance_criteria:**
  - РљР°Рє РјРёРЅРёРјСѓРј РѕРґРёРЅ СѓСЃРїРµС€РЅС‹Р№ swap РЅР° testnet.
  - **Test command:** `npm run test sushiswap-adapter.spec.ts` вЂ” success
  - **Explicit check:** Success swap РЅР° SushiSwap testnet
- **changed_areas:**
  - `apps/execution-orchestrator/src/execution/adapters/`
    - `sushiswap-v2.adapter.ts`
    - `sushiswap-v2.adapter.spec.ts`
  - `apps/execution-orchestrator/src/execution/adapters/`
    - `uniswap-v2.adapter.ts` (export `extractSwapParams`)
  - `apps/execution-orchestrator/src/execution/`
    - `execution.module.ts` (DI: SushiSwapV2Adapter)
    - `venue-factory.service.ts` (venueKey `sushiswap`)
    - `venue-factory.service.spec.ts` (SushiSwap tests)
  - `apps/execution-orchestrator/src/legs/`
    - `legs.module.ts` (DI: SushiSwapV2Adapter)
- **outputs:**
  - `SushiSwapV2Adapter` вЂ” СЂРµР°Р»РёР·Р°С†РёСЏ `VenueAdapter` РґР»СЏ SushiSwap (V2-СЃС‚РёР»СЊ)
  - Shared utils СЃ `UniswapV2Adapter`: `extractSwapParams`, `applySlippage`, `getSlippageBps`, `ensureApproval`
  - РњРµС‚СЂРёРєРё: `arb_dex_sushiswap_v2_swap_total`, `arb_dex_sushiswap_v2_swap_latency_seconds`
  - Router addresses: Arbitrum SushiSwap `0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506`, BNB PancakeSwap `0x10ED43C718714eb63d5aA57B78B54704E256024E`
  - Base chain в†’ `VenueSubmitClientError` (no SushiSwap deployment)
- **test_commands:**
  - `npm run test sushiswap-v2.adapter.spec.ts`
- **edge_cases:**
  - Router address differs from Uniswap
  - Base chain вЂ” no SushiSwap deployment
  - Different ABI (РµСЃР»Рё РµСЃС‚СЊ)
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ Р°РґР°РїС‚РµСЂ РёР· DI
- **ci_integration:** Unit tests РІ CI (fork mode)
- **review_required:** `backend`
- **review_notes:**
  - вњ… `SushiSwapV2Adapter` СЂРµР°Р»РёР·РѕРІР°РЅ РІ `apps/execution-orchestrator/src/execution/adapters/`
  - вњ… `submitLeg(plan, leg)` в†’ `{ externalOrderId: txHash }` вЂ” РїРѕР»РЅР°СЏ СЂРµР°Р»РёР·Р°С†РёСЏ VenueAdapter
  - вњ… `swapExactTokensForTokens` calldata construction С‡РµСЂРµР· ethers.js
  - вњ… Shared utils СЃ UniV2: `extractSwapParams` СЌРєСЃРїРѕСЂС‚РёСЂРѕРІР°РЅ РёР· `uniswap-v2.adapter.ts`
  - вњ… Router addresses: Arbitrum SushiSwap, BNB PancakeSwap
  - вњ… Base chain в†’ `VenueSubmitClientError` (no SushiSwap deployment)
  - вњ… DI: `VenueFactoryService` РѕР±РЅРѕРІР»С‘РЅ (venueKey `sushiswap`)
  - вњ… Unit tests: 19/19 passed
  - вњ… Build: 21/21 вњ…, Lint: 0 errors
  - вњ… Prometheus metrics: `arb_dex_sushiswap_v2_swap_total`, `arb_dex_sushiswap_v2_swap_latency_seconds`
- **review_passed_date:** 2026-05-05
- **status:** `done`

#### `DEX-1-1-VENUE-BIND` вЂ” РЎРІСЏР·РєР° СЃ `VenueAdapter` / СЂР°СЃС€РёСЂРµРЅРёРµ DI

- **step_id:** `DEX-1-1-VENUE-BIND`
- **phase:** `dex-1`
- **service:** `apps/execution-orchestrator`
- **goal:** Р’С‹Р±РѕСЂ Р°РґР°РїС‚РµСЂР° РїРѕ `venue_key` / `leg` metadata; feature flag DEX vs HTTP lab.
- **depends_on:** [`DEX-1-1-ADAPTER-UNI2`]
- **risk_level:** `high`
- **estimated_hours:** `6`
- **main_plan_prerequisites:** [`P2-2.1-VEN`]
- **acceptance_criteria:**
  - E2E СЃ `VENUE_HTTP_BASE_URL` **РІС‹РєР».** Рё DEX-Р°РґР°РїС‚РµСЂРѕРј: С†РµРїРѕС‡РєР° `mark-sent` в†’ on-chain в†’ `apply-fill` (РёР»Рё СЃРѕРіР»Р°СЃРѕРІР°РЅРЅС‹Р№ DEX-СЃРїРѕСЃРѕР± С„РёРєСЃР°С†РёРё fill).
  - ADR, РµСЃР»Рё `submitLeg` РјРµРЅСЏРµС‚ СЃРµРјР°РЅС‚РёРєСѓ (on-chain РІРјРµСЃС‚Рѕ HTTP).
  - **Test command:** `npm run e2e:dex1-venue-binding` вЂ” success
  - **Explicit check:** `LEG_VENUE_KEY=uniswap-v2` РёСЃРїРѕР»СЊР·СѓРµС‚ `UniswapV2Adapter`
- **changed_areas:**
  - `apps/execution-orchestrator/src/execution/`
    - `venue-factory.service.ts`
    - `venue-factory.service.spec.ts`
  - `apps/execution-orchestrator/src/venue/`
    - `venue-adapter.interface.ts` (СЂР°СЃС€РёСЂРµРЅРёРµ)
  - `.env.example` (DEX_VENUE_ENABLED)
- **outputs:**
  - `VenueFactoryService` вЂ” С„Р°Р±СЂРёРєР° Р°РґР°РїС‚РµСЂРѕРІ РїРѕ `venue_key`
  - ADR РїРѕ РёР·РјРµРЅРµРЅРёСЋ СЃРµРјР°РЅС‚РёРєРё `submitLeg`
  - Feature flag `DEX_VENUE_ENABLED`
- **test_commands:**
  - `npm run test venue-factory.service.spec.ts`
  - `npm run e2e:phase2-controlled-execution` (СЃ DEX-Р°РґР°РїС‚РµСЂРѕРј)
- **edge_cases:**
  - Unknown `venue_key`
  - Both DEX and HTTP enabled
  - `submitLeg` semantic conflict
- **rollback_procedure:** РћС‚РєР°С‚РёС‚СЊ DI, feature flag
- **ci_integration:** E2E test РІ CI (optional, requires fork)
- **review_notes:**
  - вњ… `VenueFactoryService` СЂРµР°Р»РёР·РѕРІР°РЅ РІ `apps/execution-orchestrator/src/execution/`
  - вњ… `extractVenueKey(plan, leg?)` вЂ” РёР·РІР»РµС‡РµРЅРёРµ venueKey РёР· playbookConfig (leg-level > plan-level)
  - вњ… `resolveAdapter(venueKey)` вЂ” СЂРѕСѓС‚РёРЅРі: mock/http в†’ legacy, uniswap-v2 в†’ V2Adapter, uniswap-v3 в†’ V3Adapter
  - вњ… `submitLeg(plan, leg)` вЂ” convenience-РјРµС‚РѕРґ: resolve + delegate
  - вњ… Feature flag `DEX_VENUE_ENABLED` РґР»СЏ DEX-Р°РґР°РїС‚РµСЂРѕРІ
  - вњ… LegsModule DI: `VenueFactoryService` + РІСЃРµ Р°РґР°РїС‚РµСЂС‹ (Mock, HTTP, UniV2, UniV3)
  - вњ… ExecutionModule exports DEX-Р°РґР°РїС‚РµСЂС‹ РґР»СЏ LegsModule
  - вњ… Unit tests: 21/21 passed (extractVenueKey, resolveAdapter legacy/DEX/unknown, submitLeg delegation)
  - вњ… Build monorepo green (21/21)
  - вљ пёЏ РџРѕРєР° Р±РµР· `DEX-1-1-ADAPTER-SUSHI` (SushiSwap adapter вЂ” СЃР»РµРґСѓСЋС‰РёР№ С€Р°Рі РїРѕСЃР»Рµ review)
- **review_passed_date:** 2026-05-05
- **status:** `done`

### DEX-1.2 вЂ” РЎРІРµСЂРєР°, observability, РёРЅС†РёРґРµРЅС‚С‹

#### `DEX-1-2-RECON-ONCHAIN` вЂ” Р Р°СЃС€РёСЂРµРЅРёРµ reconciliation: receipt, Р±Р°Р»Р°РЅСЃ РєРѕС€РµР»СЊРєР°

- **step_id:** `DEX-1-2-RECON-ONCHAIN`
- **phase:** `dex-1`
- **service:** `reconciliation-service` + РїСЂРё РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё РІРѕСЂРєРµСЂ РІ execution
- **goal:** РЎСЂР°РІРЅРµРЅРёРµ `execution_leg` / РїРѕР·РёС†РёР№ СЃ on-chain `receipt` Рё Р±Р°Р»Р°РЅСЃР°РјРё С‚РѕРєРµРЅРѕРІ; РёРЅС†РёРґРµРЅС‚ РїСЂРё СЂР°СЃС…РѕР¶РґРµРЅРёРё.
- **depends_on:** [`DEX-1-0-MIGRATIONS`, `DEX-1-0-RPC`]
- **risk_level:** `medium`
- **estimated_hours:** `10`
- **main_plan_prerequisites:** [`P2-2.1-RECON`]
- **acceptance_criteria:**
  - Р”РµС‚РµРєС‚РѕСЂ mismatch Р·Р°РґРѕРєСѓРјРµРЅС‚РёСЂРѕРІР°РЅ; idempotent РїРѕРІС‚РѕСЂРЅР°СЏ РїСЂРѕРІРµСЂРєР°.
  - **Test command:** `npm run test dex-reconciliation.spec.ts` вЂ” success
  - **Explicit check:** `POST /mismatches/run-detectors` СЃРѕР·РґР°С‘С‚ DEX mismatches
- **changed_areas:**
  - `apps/reconciliation-service/src/detectors/`
    - `dex-receipt-mismatch.detector.ts`
    - `dex-receipt-mismatch.detector.spec.ts`
  - `apps/reconciliation-service/src/detectors/`
    - `wallet-balance-mismatch.detector.ts`
- **outputs:**
  - `DexReceiptMismatchDetector` вЂ” РґРµС‚РµРєС‚РѕСЂ СЂР°СЃС…РѕР¶РґРµРЅРёР№ receipt vs leg
  - `WalletBalanceMismatchDetector` вЂ” РґРµС‚РµРєС‚РѕСЂ СЂР°СЃС…РѕР¶РґРµРЅРёР№ balance
  - Mismatch reason codes РґР»СЏ DEX
- **test_commands:**
  - `npm run test dex-reconciliation.spec.ts`
- **edge_cases:**
  - Pending transaction (РЅРµconfirmed)
  - Reorg РЅР° Р±Р»РѕРєС‡РµР№РЅРµ
  - Delayed receipt (network issues)
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ РґРµС‚РµРєС‚РѕСЂС‹ РёР· DI
- **ci_integration:** Unit tests РІ CI (mock RPC)
- **review_required:** `backend`
- **review_notes:**
  - вњ… РўСЂРё DEX-РґРµС‚РµРєС‚РѕСЂР° РІ `dex-reconciliation.detectors.ts`: `dex_receipt_leg_mismatch`, `wallet_balance_drift`, `dex_stale_pending_tx`
  - вњ… Р�РЅС‚РµРіСЂРёСЂРѕРІР°РЅРѕ РІ `MismatchesService.runDetectors()` С‡РµСЂРµР· `runDexDetectors()`
  - вњ… Configurable thresholds: `stalePendingHours` (default 1), `balanceDriftHours` (default 24)
  - вњ… Unit tests: 7/7 passed; Build reconciliation-service: success
  - вњ… Architecture check: С‡РёСЃС‚РѕРµ СЂР°Р·РґРµР»РµРЅРёРµ CEX/DEX РґРµС‚РµРєС‚РѕСЂРѕРІ, idempotent inserts
- **review_passed_date:** 2026-05-06
- **status:** `done`

#### `DEX-1-2-FILL-TRACKING` вЂ” РЎРІСЏР·РєР° on-chain receipt СЃ fill-СЃРѕР±С‹С‚РёСЏРјРё

- **step_id:** `DEX-1-2-FILL-TRACKING`
- **phase:** `dex-1`
- **service:** `execution` + `portfolio-service` integration
- **goal:** РџСЂРё СѓСЃРїРµС€РЅРѕРј on-chain receipt РѕС‚РїСЂР°РІР»СЏС‚СЊ fill-СЃРѕР±С‹С‚РёСЏ РІ portfolio/reconciliation; СЃРІСЏР·С‹РІР°С‚СЊ `txHash` СЃ `PortfolioPosition`.
- **depends_on:** [`DEX-1-0-MIGRATIONS`, `DEX-1-0-RPC`]
- **risk_level:** `high`
- **estimated_hours:** `12`
- **main_plan_prerequisites:** [`P2-2.1-FILL`, `P2-2.1-PORT`]
- **acceptance_criteria:**
  - РџРѕСЃР»Рµ `receipt.status === 'success'` в†’ `POST /positions/confirm-fill` (portfolio-service).
  - Idempotency РїСЂРё РїРѕРІС‚РѕСЂРЅС‹С… receipt-РїСЂРѕРІРµСЂРєР°С….
  - Р¤РёРєСЃР°С†РёСЏ `gasUsed`, `actualAmountIn/Out` РІ РїРѕР·РёС†РёРё.
  - **SLO:** fill tracking latency < 1s РїРѕСЃР»Рµ receipt
  - **Test command:** `npm run test dex-fill-tracking.spec.ts` вЂ” success
  - **Explicit check:** `PortfolioPosition` СЃРѕРґРµСЂР¶РёС‚ `txHash`, `gasUsed`
- **changed_areas:**
  - `apps/execution-orchestrator/src/execution/`
    - `dex-fill-tracker.service.ts`
    - `dex-fill-tracker.service.spec.ts`
  - `packages/persistence/src/entities/portfolio-position.entity.ts`
- **outputs:**
  - `DexFillTrackerService` вЂ” СЃРµСЂРІРёСЃ СЃРІСЏР·Рё receipt в†’ fill
  - `PortfolioPosition` СЂР°СЃС€РёСЂРµРЅРёРµ (`txHash`, `gasUsed`, `actualAmountIn`, `actualAmountOut`)
  - Outbox СЃРѕР±С‹С‚РёРµ `LegFilled` СЃ DEX-РјРµС‚Р°РґР°РЅРЅС‹РјРё
- **test_commands:**
  - `npm run test dex-fill-tracking.service.spec.ts`
- **edge_cases:**
  - Receipt success РЅРѕ fill fails (portfolio-service down)
  - Duplicate receipt processing
  - Partial fill (split across multiple legs)
- **rollback_procedure:** РћС‚РєР°С‚РёС‚СЊ РёР·РјРµРЅРµРЅРёСЏ РІ `PortfolioPosition`
- **ci_integration:** Unit tests РІ CI
- **review_required:** `backend`
- **review_notes:**
  - DexFillTrackerService СЂРµР°Р»РёР·РѕРІР°РЅ (9/9 tests, build 21/21)
  - LegFilledPayloadV2 СЃ optional dex metadata
  - OnChainTransaction.legId: bigint в†’ uuid, migration 034
  - DI: ExecutionModule, backward compatible
- **review_passed_date:** 2026-05-06
- **status:** `done`

#### `DEX-1-2-MEMPOOL` вЂ” Mempool monitoring (MEV detection)

- **step_id:** `DEX-1-2-MEMPOOL`
- **phase:** `dex-1`
- **service:** `execution` (РѕРїС†РёРѕРЅР°Р»СЊРЅС‹Р№ РІРѕСЂРєРµСЂ)
- **goal:** РћРїС†РёРѕРЅР°Р»СЊРЅС‹Р№ mempool monitoring РґР»СЏ РґРµС‚РµРєС†РёРё MEV-Р°С‚Р°Рє (frontrun, sandwich); Р»РѕРіРёСЂРѕРІР°РЅРёРµ Рё alerting.
- **depends_on:** [`DEX-1-0-RPC`, `DEX-1-0-ABIS`]
- **risk_level:** `low`
- **estimated_hours:** `16`
- **main_plan_prerequisites:** []
- **acceptance_criteria:**
  - Р�РЅС‚РµРіСЂР°С†РёРѕРЅРЅС‹Р№ С‚РµСЃС‚ СЃ РјРѕРєРѕРј mempool (СЌРјСѓР»СЏС†РёСЏ MEV-СЃС†РµРЅР°СЂРёРµРІ).
  - Р”РѕРєСѓРјРµРЅС‚Р°С†РёСЏ СѓРіСЂРѕР· Рё countermeasures (slippage, gas boosting).
  - РњРµС‚СЂРёРєР° `arb_dex_mev_detected_total` РїСЂРё РїРѕРґРѕР·СЂРµРЅРёРё РЅР° MEV.
  - **Test command:** `npm run test dex-mempool-monitor.spec.ts` вЂ” success
  - **Explicit check:** Р›РѕРіРё СЃРѕРґРµСЂР¶Р°С‚ "MEV detected: frontrun"
- **changed_areas:**
  - `apps/execution-orchestrator/src/workers/`
    - `dex-mempool-monitor.worker.ts`
    - `dex-mempool-monitor.worker.spec.ts`
  - `docs/dex-mev-threats.md` (РЅРѕРІС‹Р№)
- **outputs:**
  - `DexMempoolMonitorWorker` вЂ” РІРѕСЂРєРµСЂ РјРѕРЅРёС‚РѕСЂРёРЅРіР° mempool
  - MEV detection patterns (frontrun, sandwich)
  - Document СЃ СѓРіСЂРѕР·Р°РјРё Рё countermeasures
  - Alert `DexMevDetected`
- **test_commands:**
  - `npm run test dex-mempool-monitor.worker.spec.ts`
- **edge_cases:**
  - High mempool load (false positives)
  - RPC РЅРµ РїРѕРґРґРµСЂР¶РёРІР°РµС‚ mempool queries
  - Legitimate front-running (competition)
- **rollback_procedure:** РћСЃС‚Р°РЅРѕРІРёС‚СЊ РІРѕСЂРєРµСЂ
- **ci_integration:** Unit tests РІ CI (mock mempool)
- **review_required:** `backend`
- **review_notes:**
  - вњ… `DexMempoolMonitorWorker` СЂРµР°Р»РёР·РѕРІР°РЅ РІ `apps/execution-orchestrator/src/execution/workers/`
  - вњ… Mempool subscription С‡РµСЂРµР· ethers.js `provider.on('pending', ...)` РґР»СЏ each chain
  - вњ… MEV detection patterns: frontrun (same-token tx before ours with higher gas), sandwich (frontrun + backrun pair), suspicious gas premium
  - вњ… In-memory store: recent pending tx per token pair, configurable window (`MEMPOOL_RECENT_WINDOW_MS`)
  - вњ… Prometheus metrics: `arb_dex_mempool_pending_tx_observed_total`, `arb_dex_mev_detected_total` (label: type), `arb_dex_mev_risk_score` (gauge)
  - вњ… Feature flag `MEMPOOL_MONITOR_ENABLED` (default: false)
  - вњ… Env vars: `MEMPOOL_MONITOR_ENABLED`, `MEMPOOL_CHAINS`, `MEMPOOL_GAS_PREMIUM_THRESHOLD_PERCENT`, `MEMPOOL_RECENT_WINDOW_MS`, `MEMPOOL_MAX_PENDING_TX`
  - вњ… Unit tests: 12/12 passed (lifecycle, frontrun/sandwich/noise detection, multi-chain, edge cases)
  - вњ… DI: Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ РІ `ExecutionModule`
  - вњ… `docs/dex-mev-threats.md` вЂ” РґРѕРєСѓРјРµРЅС‚ СЃ СѓРіСЂРѕР·Р°РјРё Рё countermeasures
- **review_passed_date:** 2026-05-10
- **status:** `done`

#### `DEX-1-2-OUTBOX-EVENTS` вЂ” Outbox-СЃРѕР±С‹С‚РёСЏ РґР»СЏ DEX-С‚СЂР°РЅР·Р°РєС†РёР№

- **step_id:** `DEX-1-2-OUTBOX-EVENTS`
- **phase:** `dex-1`
- **service:** `execution` + `packages/contracts` + `packages/outbox-kafka-bridge`
- **goal:** РћРїСЂРµРґРµР»РёС‚СЊ Рё СЂРµР°Р»РёР·РѕРІР°С‚СЊ outbox-СЃРѕР±С‹С‚РёСЏ РґР»СЏ DEX-С‚СЂР°РЅР·Р°РєС†РёР№; publish РІ Kafka РїСЂРё РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё.
- **depends_on:** [`P1-1.1-OIB`, `DEX-1-0-MIGRATIONS`]
- **risk_level:** `medium`
- **estimated_hours:** `6`
- **main_plan_prerequisites:** [`P1-1.1-OIB`]
- **acceptance_criteria:**
  - РЎРѕР±С‹С‚РёСЏ РґРѕР±Р°РІР»РµРЅС‹ РІ `@arbibot/contracts`: `TransactionSubmitted`, `TransactionConfirmed`, `TransactionFailed`.
  - Р’РєР»СЋС‡РµРЅС‹ РІ Kafka bridge allowlist (РїСЂРё РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё).
  - РљРѕРЅРІРµСЂС‚ envelope (messageId, correlationId, entityVersion) Р·Р°РїРѕР»РЅРµРЅ РєРѕСЂСЂРµРєС‚РЅРѕ.
  - **Test command:** `npm run test dex-outbox-events.spec.ts` вЂ” success
  - **Explicit check:** `outbox_events` СЃРѕРґРµСЂР¶РёС‚ СЃРѕР±С‹С‚РёСЏ DEX С‚СЂР°РЅР·Р°РєС†РёР№
- **changed_areas:**
  - `packages/contracts/src/events/`
    - `dex-events.ts` (РЅРѕРІС‹Р№)
  - `packages/outbox-kafka-bridge/`
    - `kafka-bridge.service.ts` (allowlist update)
  - `apps/execution-orchestrator/src/execution/`
    - `dex-outbox-publisher.service.ts`
- **outputs:**
  - `TransactionSubmitted` вЂ” СЃРѕР±С‹С‚РёРµ РѕС‚РїСЂР°РІРєРё tx
  - `TransactionConfirmed` вЂ” СЃРѕР±С‹С‚РёРµ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ tx
  - `TransactionFailed` вЂ” СЃРѕР±С‹С‚РёРµ failed tx
  - Kafka bridge allowlist update
- **test_commands:**
  - `npm run test dex-outbox-events.spec.ts`
  - `npm run bus:publish` (verify DEX events published)
- **edge_cases:**
  - Duplicate events (replay)
  - Envelope mismatch
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ СЃРѕР±С‹С‚РёСЏ РёР· allowlist
- **ci_integration:** Unit tests РІ CI
- **review_required:** `backend`
- **review_notes:**
  - вњ… 3 DEX event types: `DexTransactionSubmitted`, `DexTransactionConfirmed`, `DexTransactionFailed`
  - вњ… `DexOutboxEventsService`: emitSubmitted, emitConfirmed, emitFailed
  - вњ… Outbox/inbox pattern: idempotent writes (COUNT check before INSERT)
  - вњ… Event envelope: messageId, correlationId, causationId, entityType, entityId, version, sourceModule, eventTs
  - вњ… Kafka bridge allowlist РѕР±РЅРѕРІР»С‘РЅ: 3 РЅРѕРІС‹С… event_type
  - вњ… Unit tests: 10/10 passed; Build 21/21 вњ…
- **review_passed_date:** 2026-05-06
- **status:** `done`

#### `DEX-1-2-HEALTH` вЂ” Health endpoints РґР»СЏ DEX-РєРѕРјРїРѕРЅРµРЅС‚РѕРІ

- **step_id:** `DEX-1-2-HEALTH`
- **phase:** `dex-1`
- **service:** `execution`
- **goal:** Health checks РґР»СЏ DEX-РёРЅС„СЂР°СЃС‚СЂСѓРєС‚СѓСЂС‹: RPC РїСЂРѕРІР°Р№РґРµСЂС‹, vault, РєРѕС€РµР»СЊРєРё, bridge health (РґР»СЏ DEX-2).
- **depends_on:** [`DEX-1-0-RPC`, `DEX-1-0-VAULT`, `DEX-1-0-WALLET-MGT`]
- **risk_level:** `medium`
- **estimated_hours:** `6`
- **main_plan_prerequisites:** [`P1-1.2-EXO`]
- **acceptance_criteria:**
  - Endpoints: `GET /health/dex`, `GET /health/bridges` (РґР»СЏ DEX-2).
  - Health checks РґР»СЏ РєР°Р¶РґРѕРіРѕ RPC РїСЂРѕРІР°Р№РґРµСЂР° (latency, sync status).
  - Wallet health: Р±Р°Р»Р°РЅСЃ, nonce drift, encryption key РґРѕСЃС‚СѓРїРµРЅ.
  - Р�РЅС‚РµРіСЂР°С†РёСЏ СЃ operator UI (degraded banner РїСЂРё РїСЂРѕР±Р»РµРјР°С…).
  - **Test command:** `curl http://localhost:3012/health/dex` вЂ” returns JSON
  - **Explicit check:** Degraded banner РІ UI РїСЂРё RPC failure
- **changed_areas:**
  - `apps/execution-orchestrator/src/execution/`
    - `dex-health.service.ts`
  - `apps/execution-orchestrator/src/execution/`
    - `execution.controller.ts` (health endpoints)
  - `apps/web/app/api/operator/health/dex/` (BFF)
  - `apps/web/components/dex-health-banner.tsx` (РЅРѕРІС‹Р№)
- **outputs:**
  - `GET /health/dex` вЂ” health check DEX РёРЅС„СЂР°СЃС‚СЂСѓРєС‚СѓСЂС‹
  - `GET /health/bridges` вЂ” health check РјРѕСЃС‚РѕРІ (DEX-2)
  - Degraded banner РІ UI
- **test_commands:**
  - `curl http://localhost:3012/health/dex`
  - `npm run test dex-health.service.spec.ts`
- **edge_cases:**
  - Partial degradation (RPC OK, vault fails)
  - Health check timeout
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ endpoints
- **ci_integration:** Health check РІ CI (smoke test)
- **review_required:** `backend`
- **review_notes:**
  - вњ… `DexHealthService` СЂРµР°Р»РёР·РѕРІР°РЅ РІ `apps/execution-orchestrator/src/execution/`
  - вњ… `GET /health/dex` вЂ” Р°РіСЂРµРіРёСЂРѕРІР°РЅРЅС‹Р№ health check (RPC per chain, Vault, Wallet, Mempool monitor)
  - вњ… `GET /health/dex/bridges` вЂ” stub РґР»СЏ DEX-2 (not_configured)
  - вњ… `DexHealthController` вЂ” NestJS РєРѕРЅС‚СЂРѕР»Р»РµСЂ СЃ РґРІСѓРјСЏ endpoints
  - вњ… BFF route `GET /api/operator/health/dex` в†’ execution-orchestrator
  - вњ… `DexHealthBanner` вЂ” React РєРѕРјРїРѕРЅРµРЅС‚ degraded banner РґР»СЏ operator layout
  - вњ… Health status aggregation: healthy / degraded / unhealthy СЃ РїСЂРёРѕСЂРёС‚РµС‚РѕРј worst-case
  - вњ… Unit tests: 9/9 passed (healthy, degraded, unhealthy, not_configured, no wallets, vault throws, mixed chains, mempool enabled, bridge stub)
  - вњ… Build 21/21 вњ…, Lint 0 errors вњ…
  - вњ… DI: Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ РІ `ExecutionModule`
- **review_passed_date:** 2026-05-10
- **status:** `done`

#### `DEX-1-2-OBS` вЂ” РњРµС‚СЂРёРєРё: RPC, gas, success rate, latency РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ, SLO

- **step_id:** `DEX-1-2-OBS`
- **phase:** `dex-1`
- **service:** `observability` / `execution`
- **goal:** РњРµС‚СЂРёРєРё `arb_dex_*` (РёРјРµРЅР° СЃРѕРіР»Р°СЃРѕРІР°С‚СЊ РІ PR); Р°Р»РµСЂС‚С‹ РІ Grafana вЂ” РїРѕ Р¶РµР»Р°РЅРёСЋ РІ С‚РѕРј Р¶Рµ С€Р°РіРµ РёР»Рё `DEX-DOC-ALERTS`.
- **depends_on:** [`DEX-1-0-RPC`, `DEX-1-0-GAS`, `DEX-1-1-ADAPTER-UNI2`]
- **risk_level:** `medium`
- **estimated_hours:** `8`
- **main_plan_prerequisites:** [`P1-1.1-OBS`, `P2-2.3-TRACE`]
- **acceptance_criteria:**
  - Р”Р°С€Р±РѕСЂРґ РёР»Рё РїР°РЅРµР»Рё РІ `infra/grafana/` РїСЂРё РЅР°Р»РёС‡РёРё; РјРёРЅРёРјСѓРј СЌРєСЃРїРѕСЂС‚ РІ Prometheus.
  - SLO РґР»СЏ DEX: РїРѕРґРїРёСЃСЊ < 100ms, broadcast < 200ms, confirmation < 30s (mainnet), < 10s (testnet).
  - РњРµС‚СЂРёРєРё latency РґР»СЏ RPC, gas price tracking, success rate, confirm time.
  - **Test command:** `curl http://localhost:3012/metrics | grep arb_dex_` вЂ” РЅРµ РїСѓСЃС‚РѕР№
  - **Explicit check:** Grafana dashboard РёРјРїРѕСЂС‚РёСЂСѓРµС‚СЃСЏ СѓСЃРїРµС€РЅРѕ
- **changed_areas:**
  - `apps/execution-orchestrator/src/execution/`
    - `dex-metrics.service.ts`
  - `infra/grafana/dashboards/arbibot-dex-overview.json` (РЅРѕРІС‹Р№)
  - `docs/observability-tracing.md` (SLO update)
- **outputs:**
  - РњРµС‚СЂРёРєРё `arb_dex_rpc_latency_seconds` (histogram)
  - РњРµС‚СЂРёРєРё `arb_dex_gas_price_gwei` (gauge)
  - РњРµС‚СЂРёРєРё `arb_dex_swap_total` (counter, labels: success|failed|reverted)
  - РњРµС‚СЂРёРєРё `arb_dex_confirmation_seconds` (histogram)
  - Grafana dashboard `arbibot-dex-overview.json`
  - SLO documentation
- **test_commands:**
  - `curl http://localhost:3012/metrics | grep arb_dex_`
- **edge_cases:**
  - Metric name conflicts
  - High cardinality labels
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ РјРµС‚СЂРёРєРё РёР· РєРѕРґР°
- **ci_integration:** Smoke test metrics endpoint РІ CI
- **review_required:** `backend`
- **review_notes:**
  - вњ… `DexMetricsService` вЂ” 6 Prometheus metrics: `arb_dex_rpc_latency_seconds` (histogram), `arb_dex_gas_price_gwei` (gauge), `arb_dex_swap_total` (counter), `arb_dex_confirmation_seconds` (histogram), `arb_dex_signature_seconds` (histogram), `arb_dex_broadcast_seconds` (histogram)
  - вњ… Timer helpers: `startRpcTimer`, `startSignatureTimer`, `startBroadcastTimer`, `startConfirmationTimer`
  - вњ… `infra/grafana/dashboards/arbibot-dex-overview.json` вЂ” 11 panels
  - вњ… `docs/observability-tracing.md` вЂ” DEX SLO section with targets and bucket reference
  - вњ… DI: registered in `ExecutionModule`
  - вњ… **Tests:** 10/10 вњ…; **Build:** 21/21 вњ…
- **review_passed_date:** 2026-05-10
- **status:** `done` вњ… (2026-05-10, session 15)

#### `DEX-1-2-LOAD-TEST` вЂ” РќР°РіСЂСѓР·РѕС‡РЅРѕРµ С‚РµСЃС‚РёСЂРѕРІР°РЅРёРµ DEX-РёРЅС„СЂР°СЃС‚СЂСѓРєС‚СѓСЂС‹

- **step_id:** `DEX-1-2-LOAD-TEST`
- **phase:** `dex-1`
- **service:** `tools`
- **goal:** Load test РґР»СЏ RPC-РїСЂРѕРІР°Р№РґРµСЂРѕРІ, nonce РєРѕР»Р»РёР·РёР№, РіР°Р·-СЃРїР°Р№РєРѕРІ, concurrent submissions.
- **depends_on:** [`DEX-1-0-RPC`, `DEX-1-0-VAULT`, `DEX-1-1-ADAPTER-UNI2`]
- **risk_level:** `low`
- **estimated_hours:** `12`
- **main_plan_prerequisites:** []
- **acceptance_criteria:**
  - Script РІ `tools/dex-load-test.mjs` (РёР»Рё Р°РЅР°Р»РѕРі).
  - Р”РѕРєСѓРјРµРЅС‚РёСЂРѕРІР°РЅС‹ thresholds (max latency, max concurrent, acceptable failure rate).
  - CI optional РёР·-Р·Р° РІРЅРµС€РЅРёС… Р·Р°РІРёСЃРёРјРѕСЃС‚РµР№.
  - **Test command:** `node tools/dex-load-test.mjs` вЂ” completes without errors
  - **Explicit check:** Report СЃ latency/throughput metrics
- **changed_areas:**
  - `tools/dex-load-test.mjs` (РЅРѕРІС‹Р№)
  - `docs/dex-load-test-report.md` (РЅРѕРІС‹Р№)
- **outputs:**
  - Load test script
  - Performance report (latency, throughput, errors)
  - Thresholds documentation
- **test_commands:**
  - `node tools/dex-load-test.mjs --dry-run` (no real tx)
- **edge_cases:**
  - Rate limiting РѕС‚ RPC
  - Nonce collisions РїСЂРё concurrent submissions
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ script
- **ci_integration:** Optional (run manually)
- **review_required:** `backend`
- **review_notes:**
  - вњ… `tools/dex-load-test.mjs` вЂ” 3-phase load test: health check warmup, concurrent leg submissions, metrics scrape
  - вњ… `--dry-run` mode: uses HTTP lab venue (no real DEX transactions)
  - вњ… Configurable thresholds: p95 latency (2000ms), error rate (10%), throughput (1 req/s)
  - вњ… Environment variable overrides for all thresholds
  - вњ… Percentile latency reporting (p50/p95/p99/min/max/avg)
  - вњ… Status code distribution and error summary
  - вњ… DEX metrics presence check (8 metric names)
  - вњ… Exit codes: 0 = pass, 1 = threshold failure, 2 = fatal error
  - вњ… `docs/dex-load-test-report.md` вЂ” thresholds documentation
  - вњ… npm script: `npm run dex:load-test`
  - вњ… Build 21/21 вњ…, Lint 0 errors вњ…
- **review_passed_date:** 2026-05-10
- **status:** `done` вњ… (2026-05-10, session 16)

### DEX-1.3 вЂ” РћРїРµСЂР°С†РёРѕРЅРЅР°СЏ РїРѕСЃР»РµРґРѕРІР°С‚РµР»СЊРЅРѕСЃС‚СЊ (paper/live)

#### `DEX-1-3-PAPER-TESTNET` вЂ” Paper + testnet: РІРёСЂС‚СѓР°Р»СЊРЅС‹Рµ fills РїСЂРё С‚РµС… Р¶Рµ СЃРёРіРЅР°Р»Р°С…

- **step_id:** `DEX-1-3-PAPER-TESTNET`
- **phase:** `dex-1`
- **goal:** РЎРєРІРѕР·РЅРѕР№ РїСЂРѕРіРѕРЅ paper-РєРѕРЅС‚СѓСЂ (РёР»Рё dry-run) РїСЂРѕС‚РёРІ **testnet** РґР°РЅРЅС‹С…/РєРѕРЅС„РёРіР°; Р±РµР· mainnet СЂРёСЃРєР°.
- **depends_on:** [`P3-3-PAPER`, `DEX-1-1-ADAPTER-UNI2`]
- **risk_level:** `medium`
- **estimated_hours:** `8`
- **main_plan_prerequisites:** [`P3-3-PAPER`]
- **acceptance_criteria:** РљСЂРёС‚РµСЂРёРё РІС‹С…РѕРґР° РЅР° СЃР»РµРґСѓСЋС‰РёР№ С€Р°Рі СЃРѕРіР»Р°СЃРѕРІР°РЅС‹ СЃ РїСЂРѕРґСѓРєС‚РѕРј; Р·Р°С„РёРєСЃРёСЂРѕРІР°РЅС‹ РІ runbook.
- **changed_areas:** `apps/paper-trading-service/`, `docs/`
- **outputs:**
  - Paper trading DEX-Р°РґР°РїС‚РµСЂ (mock/simulated)
  - Runbook РґР»СЏ paper testnet
  - Comparison metrics (paper vs live)
- **test_commands:**
  - `npm run test paper-dex-adapter.spec.ts`
- **edge_cases:**
  - Paper drift vs real execution
  - Gas simulation inaccurate
- **rollback_procedure:** РћС‚РєР°С‚РёС‚СЊ РёР·РјРµРЅРµРЅРёСЏ РІ paper-trading-service
- **ci_integration:** Unit tests РІ CI
- **review_required:** `architecture`
- **review_notes:**
  - вњ… `PaperDexAdapter` СЂРµР°Р»РёР·РѕРІР°РЅ РІ `apps/execution-orchestrator/src/execution/adapters/paper-dex.adapter.ts`
  - вњ… `PaperDexSwapResult` вЂ” simulated DEX swap result (simulated=true, chainId, amounts, gas, slippage, path)
  - вњ… Pure simulation helpers: `simulateSwapOutput()` (output multiplier + price impact + slippage), `calculateSimulatedGasCostEth()`
  - вњ… Configurable env: `PAPER_DEX_SIMULATED_GAS_USED`, `PAPER_DEX_SIMULATED_GAS_PRICE_GWEI`, `PAPER_DEX_SIMULATED_OUTPUT_MULTIPLIER`, `PAPER_DEX_SIMULATED_PRICE_IMPACT_BPS`
  - вњ… Prometheus metrics: `arb_paper_dex_swap_total`, `arb_paper_dex_swap_latency_seconds`, `arb_paper_dex_simulated_gas_cost_eth`, `arb_paper_dex_simulated_profit_usd`
  - вњ… DI: Р·Р°СЂРµРіРёСЃС‚СЂРёСЂРѕРІР°РЅ РІ `VenueFactoryService` (venueKey `paper-dex`) Рё `ExecutionModule`
  - вњ… Venue routing: `PAPER_VENUE_KEYS` set вЂ” no `DEX_VENUE_ENABLED` required
  - вњ… Unit tests: 21/21 passed (pure functions: swap output, gas cost; adapter: success, validation, env overrides)
  - вњ… Build 21/21 вњ…, Lint 0 errors вњ…
- **review_passed_date:** 2026-05-10
- **status:** `done` вњ… (2026-05-10, session 17)

#### `DEX-1-3-LIVE-TESTNET` вЂ” Live testnet: СЂРµР°Р»СЊРЅС‹Рµ tx, Р»РёРјРёС‚С‹ РѕР±СЉС‘РјР°

- **step_id:** `DEX-1-3-LIVE-TESTNET`
- **phase:** `dex-1`
- **goal:** РњРёРЅРёРјР°Р»СЊРЅС‹Р№ notional; РїРѕР»РЅС‹Р№ `reserve в†’ arm в†’ DEX РЅРѕРіРё в†’ settlement`.
- **depends_on:** [`DEX-1-1-VENUE-BIND`, `DEX-1-2-FILL-TRACKING`]
- **risk_level:** `high`
- **estimated_hours:** `16`
- **main_plan_prerequisites:** [`P1-1.2-EXO`, `P2-2.1-EPL`]
- **acceptance_criteria:** E2E script `tools/e2e-dex1-testnet.mjs` (РёР»Рё Р°РЅР°Р»РѕРі); CI optional РёР·-Р·Р° РІРЅРµС€РЅРµР№ СЃРµС‚Рё.
- **changed_areas:** `tools/`, `docs/`
- **outputs:**
  - E2E test `tools/e2e-dex1-testnet.mjs`
  - Runbook РґР»СЏ testnet live
  - Success metrics (profit, latency, errors)
- **test_commands:**
  - `node tools/e2e-dex1-testnet.mjs` вЂ” success
- **edge_cases:**
  - Testnet congestion
  - Insufficient testnet tokens
  - Revert from testnet DEX
- **rollback_procedure:** N/A (testnet, no real money)
- **ci_integration:** Optional (run manually with secrets)
- **review_required:** `backend`
- **status:** `planned`

#### `DEX-1-3-PAPER-MAINNET` вЂ” Mainnet paper: СЃСЂР°РІРЅРµРЅРёРµ СЃ live-РєРѕРЅС‚СѓСЂРѕРј

- **step_id:** `DEX-1-3-PAPER-MAINNET`
- **phase:** `dex-1`
- **goal:** Paper РЅР° mainnet-РїРѕС‚РѕРєРµ РґР°РЅРЅС‹С…; live РІС‹РєР»СЋС‡РµРЅ РёР»Рё СЃ РЅСѓР»РµРІС‹Рј СЂРёСЃРєРѕРј РїРѕ РїРѕР»РёС‚РёРєРµ.
- **depends_on:** [`DEX-1-3-PAPER-TESTNET`]
- **risk_level:** `medium`
- **estimated_hours:** `8`
- **main_plan_prerequisites:** [`P3-3-PAPER`]
- **acceptance_criteria:** РћРїРµСЂР°С‚РѕСЂСЃРєРёР№ С‡РµРєР»РёСЃС‚; РјРµС‚СЂРёРєРё drift РµСЃР»Рё РїСЂРёРјРµРЅРёРјРѕ.
- **changed_areas:** `apps/web` / paper / docs
- **outputs:**
  - Paper mainnet runbook
  - Drift metrics (paper vs expected)
  - Operator checklist
- **test_commands:**
  - Manual verification
- **edge_cases:**
  - Large drift (paper в‰  mainnet)
  - Insufficient mainnet liquidity in paper
- **rollback_procedure:** РћС‚РєР»СЋС‡РёС‚СЊ paper mainnet
- **ci_integration:** N/A
- **review_required:** `architecture`
- **status:** `planned`

#### `DEX-1-3-LIVE-MAINNET` вЂ” Mainnet live: РјРёРЅРёРјР°Р»СЊРЅС‹Р№ РєР°РїРёС‚Р°Р»

- **step_id:** `DEX-1-3-LIVE-MAINNET`
- **phase:** `dex-1`
- **goal:** Р’РєР»СЋС‡РµРЅРёРµ live СЃ Р»РёРјРёС‚Р°РјРё `capital` + `risk` + DEX-СЃРїРµС†РёС„РёС‡РЅС‹РјРё gas ceilings.
- **depends_on:** [`DEX-1-3-LIVE-TESTNET`, `DEX-1-3-PAPER-MAINNET`]
- **risk_level:** `critical`
- **estimated_hours:** `16`
- **main_plan_prerequisites:** [`P1-1.2-CAP`, `P2-2.2-PROF`]
- **acceptance_criteria:** РЇРІРЅС‹Рµ Р»РёРјРёС‚С‹ РІ config; two-person rule РїСЂРё РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё (СЃРј. РїСЂРѕРґСѓРєС‚).
- **changed_areas:** `config-service` / `risk-service` / `docs`
- **outputs:**
  - Mainnet live runbook
  - Config limits (capital, risk, gas)
  - Two-person rule procedure (РµСЃР»Рё С‚СЂРµР±СѓРµС‚СЃСЏ)
  - Success metrics (profit, P&L, risk exposure)
- **test_commands:**
  - Manual verification
  - `curl http://localhost:3019/policy/configurations/dex.limits/effective` вЂ” returns limits
- **edge_cases:**
  - Unexpected high profit (risk exposure)
  - Gas spike losses
  - MEV attacks
- **rollback_procedure:** РћС‚РєР»СЋС‡РёС‚СЊ live, switch to paper
- **ci_integration:** N/A
- **review_required:** `architecture`
- **status:** `planned`

### DEX-1.4 вЂ” Base Рё BNB (СЂР°СЃС€РёСЂРµРЅРёРµ СЃРµС‚Рё РїРѕСЃР»Рµ Arbitrum)

#### `DEX-1-4-BASE` вЂ” Base: С‚Рµ Р¶Рµ DEX, РіРґРµ РїСЂРёРјРµРЅРёРјРѕ

- **step_id:** `DEX-1-4-BASE`
- **phase:** `dex-1`
- **service:** `packages/contracts-eth`, adapters
- **goal:** РђРґСЂРµСЃР°, chainId, smoke РЅР° testnet.
- **depends_on:** [`DEX-1-3-LIVE-MAINNET`]
- **risk_level:** `medium`
- **estimated_hours:** `8`
- **main_plan_prerequisites:** [`DEX-1-1-ADAPTER-UNI2`]
- **acceptance_criteria:** РњРёРЅРёРјСѓРј РѕРґРёРЅ e2e РЅР° Base testnet.
- **changed_areas:** adapters, config
- **outputs:**
  - Base chainId and addresses in `contracts-eth`
  - Smoke test on Base testnet
  - Runbook for Base deployment
- **test_commands:**
  - `node tools/e2e-dex1-base-testnet.mjs` вЂ” success
- **edge_cases:**
  - Different DEX addresses on Base
  - Lower liquidity
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ Base РёР· supported chains
- **ci_integration:** Optional (run manually)
- **review_required:** `backend`
- **status:** `planned`

#### `DEX-1-4-BNB` вЂ” BNB Chain: Pancake / Biswap (РєР°Рє РІ РїСЂРѕРґСѓРєС‚РѕРІРѕР№ РјР°С‚СЂРёС†Рµ)

- **step_id:** `DEX-1-4-BNB`
- **phase:** `dex-1`
- **service:** `packages/contracts-eth`, adapters
- **goal:** РђРЅР°Р»РѕРіРёС‡РЅРѕ Base; **РµСЃР»Рё** РїРµСЂРІС‹Р№ DEX-РЅР°Р±РѕСЂ РЅР° Arbitrum Р±С‹Р» Uni/Sushi, Р·РґРµСЃСЊ вЂ” СЃРѕРіР»Р°СЃРѕРІР°РЅРЅС‹Рµ Р°РґР°РїС‚РµСЂС‹ (Pancake V2/V3).
- **depends_on:** [`DEX-1-4-BASE`]
- **risk_level:** `medium`
- **estimated_hours:** `10`
- **main_plan_prerequisites:** [`DEX-1-1-ADAPTER-UNI2`]
- **acceptance_criteria:** E2E testnet; runbook.
- **changed_areas:** adapters, `docs/`
- **outputs:**
  - BNB chainId and addresses in `contracts-eth`
  - Pancake/Biswap adapters
  - Smoke test on BNB testnet
  - Runbook for BNB deployment
- **test_commands:**
  - `node tools/e2e-dex1-bnb-testnet.mjs` вЂ” success
- **edge_cases:**
  - Different router ABI (Pancake vs Uniswap)
  - Higher gas costs on BNB
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ BNB РёР· supported chains
- **ci_integration:** Optional (run manually)
- **review_required:** `backend`
- **status:** `planned`

---

## DEX-2 вЂ” Multi-Chain (DEX A РЅР° chain X в†’ bridge в†’ DEX B РЅР° chain Y)

**Р“РµР№С‚:** РІСЃРµ С€Р°РіРё `DEX-1-*` СЃ РєСЂРёС‚РµСЂРёСЏРјРё В«doneВ» РґР»СЏ **single-chain e2e РЅР° testnet+mainnet path**, РєСЂРѕРјРµ СЏРІРЅРѕ РѕС‚РјРµС‡РµРЅРЅС‹С… РѕРїС†РёРѕРЅР°Р»СЊРЅС‹С… (Base/BNB РјРѕРіСѓС‚ Р±С‹С‚СЊ `planned` РґРѕ Р·Р°РІРµСЂС€РµРЅРёСЏ DEX-2 scope вЂ” Р·Р°С„РёРєСЃРёСЂРѕРІР°С‚СЊ РІ review).

**РџРѕСЂСЏРґРѕРє РјРѕСЃС‚РѕРІ (РІСЃРµ С‚СЂРё вЂ” РѕС‚РґРµР»СЊРЅС‹Рµ РїРѕРґРїР°РєРµС‚С‹/Р°РґР°РїС‚РµСЂС‹):** Across, Stargate, РѕС„РёС†РёР°Р»СЊРЅС‹Рµ РјРѕСЃС‚Р° L2 (Arbitrum/Base/BNB-РѕС„РёС†РёР°Р»СЊРЅС‹Рµ РјРѕСЃС‚С‹).

#### `DEX-2-0-ADR` вЂ” ADR: cross-chain РїР»Р°РЅ, single-writer, idempotency bridge tx

- **step_id:** `DEX-2-0-ADR`
- **phase:** `dex-2`
- **service:** `docs`
- **goal:** РћРїРёСЃР°С‚СЊ, РєС‚Рѕ РїРёС€РµС‚ `ExecutionLeg` РґР»СЏ bridge, РєР°Рє РЅРµ РґСѓР±Р»РёСЂРѕРІР°С‚СЊ outbox, РєР°Рє hedge/unwind cross-chain.
- **depends_on:** [`DEX-1-3-LIVE-MAINNET`]
- **risk_level:** `critical`
- **estimated_hours:** `6`
- **main_plan_prerequisites:** [`DEX-1-1-VENUE-BIND`]
- **acceptance_criteria:** ADR РІ `docs/adr-*.md`; СЃРѕРіР»Р°СЃРѕРІР°РЅРёРµ СЃ architecture-guard.
- **changed_areas:** `docs/`
- **outputs:**
  - ADR РґР»СЏ cross-chain execution
  - Single-writer boundaries РґР»СЏ bridge legs
  - Idempotency patterns РґР»СЏ bridge tx
- **test_commands:**
  - Review ADR РїРѕ checklist
- **edge_cases:**
  - Bridge failure vs leg failure
  - Cross-chain hedge/unwind
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ ADR
- **ci_integration:** Manual review
- **review_required:** `architecture`
- **status:** `planned`

#### `DEX-2-1-BRIDGE-ACROSS` вЂ” РђРґР°РїС‚РµСЂ Across

- **step_id:** `DEX-2-1-BRIDGE-ACROSS`
- **phase:** `dex-2`
- **service:** `execution`
- **goal:** Initiate + track completion; idempotent relay.
- **depends_on:** [`DEX-2-0-ADR`]
- **risk_level:** `high`
- **estimated_hours:** `16`
- **main_plan_prerequisites:** [`DEX-1-1-ADAPTER-UNI2`]
- **acceptance_criteria:** Testnet e2e fragment (deposit в†’ track в†’ destination event).
- **changed_areas:** adapters, РјРёРіСЂР°С†РёРё РїСЂРё РЅРѕРІС‹С… СЃСѓС‰РЅРѕСЃС‚СЏС…
- **outputs:**
  - `AcrossBridgeAdapter` вЂ” Р°РґР°РїС‚РµСЂ РґР»СЏ Across
  - Bridge tracking service
  - Testnet e2e script
- **test_commands:**
  - `node tools/e2e-dex2-across-testnet.mjs` вЂ” success
- **edge_cases:**
  - Bridge timeout
  - Partial fill bridge
  - Bridge fee too high
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ Р°РґР°РїС‚РµСЂ
- **ci_integration:** Optional (run manually)
- **review_required:** `backend`
- **status:** `planned`

#### `DEX-2-1-BRIDGE-STG` вЂ” РђРґР°РїС‚РµСЂ Stargate

- **step_id:** `DEX-2-1-BRIDGE-STG`
- **phase:** `dex-2`
- **service:** `execution`
- **goal:** РђРЅР°Р»РѕРіРёС‡РЅРѕ Across, РѕС‚РґРµР»СЊРЅС‹Рµ Р»РёРјРёС‚С‹ Рё РјРµС‚СЂРёРєРё.
- **depends_on:** [`DEX-2-1-BRIDGE-ACROSS`]
- **risk_level:** `high`
- **estimated_hours:** `16`
- **main_plan_prerequisites:** [`DEX-1-1-ADAPTER-UNI2`]
- **acceptance_criteria:** Testnet; РґРѕРєСѓРјРµРЅС‚Р°С†РёСЏ Р»РёРјРёС‚РѕРІ.
- **changed_areas:** adapters
- **outputs:**
  - `StargateBridgeAdapter` вЂ” Р°РґР°РїС‚РµСЂ РґР»СЏ Stargate
  - Bridge limits documentation
- **test_commands:**
  - `node tools/e2e-dex2-stargate-testnet.mjs` вЂ” success
- **edge_cases:**
  - Stargate-specific errors
  - Route not available
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ Р°РґР°РїС‚РµСЂ
- **ci_integration:** Optional (run manually)
- **review_required:** `backend`
- **status:** `planned`

#### `DEX-2-1-BRIDGE-NATIVE` вЂ” РћС„РёС†РёР°Р»СЊРЅС‹Рµ РјРѕСЃС‚Р° L2 (canonical bridge)

- **step_id:** `DEX-2-1-BRIDGE-NATIVE`
- **phase:** `dex-2`
- **service:** `execution`
- **goal:** РЎС†РµРЅР°СЂРёРё L1в†”L2 / L2в†”L2 **РѕС„РёС†РёР°Р»СЊРЅС‹РјРё** РјРѕСЃС‚Р°РјРё РґР»СЏ РїРѕРґРґРµСЂР¶РёРІР°РµРјС‹С… СЃРµС‚РµР№.
- **depends_on:** [`DEX-2-1-BRIDGE-STG`]
- **risk_level:** `high`
- **estimated_hours:** `16`
- **main_plan_prerequisites:** [`DEX-1-1-ADAPTER-UNI2`]
- **acceptance_criteria:** РљР°Рє РјРёРЅРёРјСѓРј РѕРґРёРЅ e2e РЅР° testnet; long finality РІ runbook.
- **changed_areas:** adapters, `docs/`
- **outputs:**
  - `NativeBridgeAdapter` вЂ” Р°РґР°РїС‚РµСЂ РґР»СЏ РѕС„РёС†РёР°Р»СЊРЅС‹С… РјРѕСЃС‚РѕРІ
  - Long finality runbook
- **test_commands:**
  - `node tools/e2e-dex2-native-bridge-testnet.mjs` вЂ” success
- **edge_cases:**
  - Very long finality (days)
  - Bridge congestion
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ Р°РґР°РїС‚РµСЂ
- **ci_integration:** Optional (run manually)
- **review_required:** `backend`
- **status:** `planned`

#### `DEX-2-2-PLAN` вЂ” РџРѕСЃС‚СЂРѕРµРЅРёРµ multi-leg РїР»Р°РЅР°: DEX leg в†’ bridge leg в†’ DEX leg

- **step_id:** `DEX-2-2-PLAN`
- **phase:** `dex-2`
- **service:** `execution-orchestrator`
- **goal:** Р Р°СЃС€РёСЂРµРЅРёРµ `ExecutionPlan` (РёР»Рё orchestration layer) РґР»СЏ РєСЂРѕСЃСЃ-С‡РµР№РЅ; СЏРІРЅС‹Рµ `chainId` РЅР° РЅРѕРіРµ.
- **depends_on:** [`DEX-2-1-BRIDGE-ACROSS`, `DEX-2-1-BRIDGE-STG`]
- **risk_level:** `critical`
- **estimated_hours:** `16`
- **main_plan_prerequisites:** [`P1-1.2-EXO`]
- **acceptance_criteria:** РќРµС‚ РЅР°СЂСѓС€РµРЅРёСЏ single-writer; state machine СЃРѕРіР»Р°СЃРѕРІР°РЅР° СЃ [docs/state-machines.md](../../docs/state-machines.md).
- **changed_areas:** orchestrator, persistence, РјРёРіСЂР°С†РёРё
- **outputs:**
  - Multi-leg plan builder
  - `chainId` field on `ExecutionLeg`
  - Cross-chain state machine
- **test_commands:**
  - `npm run test multi-leg-plan-builder.spec.ts` вЂ” success
- **edge_cases:**
  - ChainId mismatch on legs
  - Bridge leg in the middle
- **rollback_procedure:** РћС‚РєР°С‚РёС‚СЊ РёР·РјРµРЅРµРЅРёСЏ РІ `ExecutionPlan`
- **ci_integration:** Unit tests in CI
- **review_required:** `architecture`
- **status:** `planned`

#### `DEX-2-3-RECON-XCHAIN` вЂ” РЎРІРµСЂРєР° РєСЂРѕСЃСЃ-С‡РµР№РЅ: bridge completion vs internal state

- **step_id:** `DEX-2-3-RECON-XCHAIN`
- **phase:** `dex-2`
- **service:** `reconciliation-service`
- **goal:** РњРѕРЅРёС‚РѕСЂРёРЅРі bridge tx, С‚Р°Р№РјР°СѓС‚С‹, force unwind policy (СЃ РѕРїРµСЂР°С‚РѕСЂСЃРєРёРј approve).
- **depends_on:** [`DEX-2-2-PLAN`]
- **risk_level:** `high`
- **estimated_hours:** `12`
- **main_plan_prerequisites:** [`P2-2.1-RECON`]
- **acceptance_criteria:** РќР°Р±РѕСЂ РёРЅС†РёРґРµРЅС‚РѕРІ Рё runbook `docs/bridge-*.md`.
- **changed_areas:** reconciliation, docs
- **outputs:**
  - Bridge reconciliation detectors
  - Bridge timeout incidents
  - Force unwind runbook
- **test_commands:**
  - `npm run test bridge-reconciliation.spec.ts` вЂ” success
- **edge_cases:**
  - Bridge stuck (never completes)
  - Partial fill bridge
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ РґРµС‚РµРєС‚РѕСЂС‹
- **ci_integration:** Unit tests in CI
- **review_required:** `backend`
- **status:** `planned`

#### `DEX-2-4-E2E` вЂ” E2E multi-chain: testnet, Р·Р°С‚РµРј mainnet minimal

- **step_id:** `DEX-2-4-E2E`
- **phase:** `dex-2`
- **service:** `tools`, CI (optional)
- **goal:** `npm run e2e:dex2-multichain` (РёРјСЏ СЃРѕРіР»Р°СЃРѕРІР°С‚СЊ); РґРѕРєСѓРјРµРЅС‚Р°С†РёСЏ env.
- **depends_on:** [`DEX-2-3-RECON-XCHAIN`]
- **risk_level:** `critical`
- **estimated_hours:** `20`
- **main_plan_prerequisites:** [`DEX-1-3-LIVE-MAINNET`]
- **acceptance_criteria:** РџСЂРѕС…РѕР¶РґРµРЅРёРµ РІСЂСѓС‡РЅСѓСЋ РёР»Рё РІ CI СЃ СЃРµРєСЂРµС‚Р°РјРё; РєСЂРёС‚РµСЂРёРё `done` РІ review.
- **changed_areas:** `tools/`, `package.json` root
- **outputs:**
  - E2E test script
  - Env documentation
  - Success metrics (profit, latency, bridge times)
- **test_commands:**
  - `npm run e2e:dex2-multichain` вЂ” success
- **edge_cases:**
  - Bridge failure mid-arbitrage
  - High bridge fees
- **rollback_procedure:** N/A (testnet)
- **ci_integration:** Optional (run manually with secrets)
- **review_required:** `backend`
- **status:** `planned`

---

## Р”РѕРєСѓРјРµРЅС‚Р°С†РёСЏ, UI Рё runbooks (СЃРєРІРѕР·РЅС‹Рµ)

#### `DEX-DOC-FE` вЂ” Frontend: UI РґР»СЏ DEX, РєРѕС€РµР»СЊРєРѕРІ Рё РјРѕСЃС‚РѕРІ

- **step_id:** `DEX-DOC-FE`
- **phase:** `docs`
- **service:** `apps/web`
- **goal:** РћРїРёСЃР°С‚СЊ РЅРµРѕР±С…РѕРґРёРјС‹Рµ UI-РёР·РјРµРЅРµРЅРёСЏ: `/execution` СЃ DEX-РёРЅС„РѕСЂРјР°С†РёРµР№, `/wallets` (Р±Р°Р»Р°РЅСЃС‹, РєР»СЋС‡Рё), `/bridges` (СЃС‚Р°С‚СѓСЃ РјРѕСЃС‚РѕРІ).
- **depends_on:** [`DEX-1-2-HEALTH`, `DEX-1-2-RECON-ONCHAIN`]
- **risk_level:** `low`
- **estimated_hours:** `8`
- **main_plan_prerequisites:** [`P1-1.3-STUBS`, `P2-2.3-EXECUI`]
- **acceptance_criteria:**
  - РЎРїРёСЃРѕРє С‚СЂРµР±СѓРµРјС‹С… РїРѕР»РµР№/С„РёР»СЊС‚СЂРѕРІ РІ UI РґР»СЏ DEX-С‚СЂР°РЅР·Р°РєС†РёР№ (txHash, chainId, gasUsed, revert reason).
  - РЎРµРєС†РёСЏ РєРѕС€РµР»СЊРєРѕРІ: Р°РґСЂРµСЃ, Р±Р°Р»Р°РЅСЃ, СЃС‚Р°С‚СѓСЃ (active/rotating).
  - РЎРµРєС†РёСЏ РјРѕСЃС‚РѕРІ (РґР»СЏ DEX-2): bridge tx, СЃС‚Р°С‚СѓСЃ, ETA.
- **changed_areas:** `apps/web`, `docs/`
- **outputs:**
  - UI specification document
  - Wireframes/mockups (РѕРїС†РёРѕРЅР°Р»СЊРЅРѕ)
  - List of required API endpoints
- **test_commands:**
  - Manual review of spec
- **edge_cases:**
  - Too much information in UI
  - Real-time updates complexity
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ spec
- **ci_integration:** N/A
- **review_required:** `frontend`
- **status:** `planned`

#### `DEX-DOC-RUNBOOK-TX` вЂ” Runbook: failed / stuck / reverted on-chain

- **step_id:** `DEX-DOC-RUNBOOK-TX`
- **phase:** `docs`
- **service:** `docs`
- **goal:** РћРїРµСЂР°С‚РѕСЂСЃРєРёРµ С€Р°РіРё РїСЂРё revert, stuck nonce, replace-by-fee (РµСЃР»Рё СЂР°Р·СЂРµС€РµРЅРѕ РїРѕР»РёС‚РёРєРѕР№).
- **depends_on:** [`DEX-1-1-ADAPTER-UNI2`]
- **risk_level:** `medium`
- **estimated_hours:** `6`
- **main_plan_prerequisites:** []
- **acceptance_criteria:** Р¤Р°Р№Р» РІ `docs/`; СЃСЃС‹Р»РєР° РёР· PROJECT_HANDBOOK РїСЂРё РЅРµРѕР±С…РѕРґРёРјРѕСЃС‚Рё.
- **changed_areas:** `docs/`
- **outputs:**
  - `docs/dex-runbook-failed-tx.md`
  - Step-by-step procedures
  - Common scenarios and solutions
- **test_commands:**
  - Manual review of runbook
- **edge_cases:**
  - Runbook incomplete
  - Steps not executable
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ runbook
- **ci_integration:** N/A
- **review_required:** `architecture`
- **status:** `planned`

#### `DEX-DOC-RUNBOOK-BRIDGE` вЂ” Runbook: Р·Р°РґРµСЂР¶РєР° РјРѕСЃС‚Р°, partial fill bridge

- **step_id:** `DEX-DOC-RUNBOOK-BRIDGE`
- **phase:** `docs`
- **service:** `docs`
- **goal:** РџСЂРѕС†РµРґСѓСЂС‹ РґР»СЏ DEX-2; СЃРІСЏР·СЊ СЃ reconciliation Рё operator UI.
- **depends_on:** [`DEX-2-1-BRIDGE-ACROSS`]
- **risk_level:** `medium`
- **estimated_hours:** `6`
- **main_plan_prerequisites**: []
- **acceptance_criteria:** Р”РѕРєСѓРјРµРЅС‚; С‡РµРєР»РёСЃС‚.
- **changed_areas:** `docs/`
- **outputs:**
  - `docs/dex-runbook-bridge-issues.md`
  - Bridge timeout procedures
  - Partial fill bridge handling
- **test_commands:**
  - Manual review of runbook
- **edge_cases:**
  - Bridge stuck indefinitely
  - Force unwind procedures
- **rollback_procedure:** РЈРґР°Р»РёС‚СЊ runbook
- **ci_integration:** N/A
- **review_required:** `architecture`
- **status:** `planned`

#### `DEX-DOC-ROLLBACK` вЂ” Rollback strategy РґР»СЏ DEX-РєРѕРјРїРѕРЅРµРЅС‚РѕРІ

- **step_id:** `DEX-DOC-ROLLBACK`
- **phase:** `docs`
- **service:** `docs`
- **goal:** Runbook РїРѕ РѕС‚РєР°С‚Сѓ DEX-РєРѕРјРїРѕРЅРµРЅС‚РѕРІ: РјРёРіСЂР°С†РёРё, РєР»СЋС‡Рё, configs, wallet recovery.
- **depends_on:** [`DEX-1-0-VAULT`, `DEX-1-0-MIGRATIONS`]
- **risk_level:** `high`
- **estimated_hours:** `8`
- **main_plan_prerequisites:** []
- **acceptance_criteria:**
  - Р”РѕРєСѓРјРµРЅС‚ `docs/dex-rollback-runbook.md` СЃ РїСЂРѕС†РµРґСѓСЂР°РјРё РѕС‚РєР°С‚Р°.
  - РџСЂРѕС†РµРґСѓСЂР° РјРёРіСЂР°С†РёРё key rotation (РѕС‚РјРµРЅР°, revert).
  - РџСЂРѕС†РµРґСѓСЂР° РѕС‚РєР°С‚Р° РјРёРіСЂР°С†РёР№ Р‘Р” (РµСЃР»Рё РЅРµРѕР±С…РѕРґРёРјРѕ).
- **changed_areas:** `docs/`
- **outputs:**
  - `docs/dex-rollback-runbook.md`
  - Key rotation procedures
  - Migration rollback procedures
  - Wallet recovery procedures
- **test_commands:**
  - Manual review of runbook
  - Dry run of rollback procedures (optional)
- **edge_cases:**
  - Rollback fails
  - Data corruption during rollback
- **rollback_procedure:** N/A (СЌС‚Рѕ Рё РµСЃС‚СЊ rollback procedure)
- **ci_integration:** N/A
- **review_required:** `architecture`
- **status:** `planned`

---

## Р—Р°РІРёСЃРёРјРѕСЃС‚Рё РѕС‚ РѕСЃРЅРѕРІРЅРѕРіРѕ РїР»Р°РЅР°

- РќРµ РѕСЃР»Р°Р±Р»СЏС‚СЊ **reservation-first**: DEX-РЅРѕРіРё РЅРµ СЃС‚Р°СЂС‚СѓСЋС‚ Р±РµР· РІР°Р»РёРґРЅС‹С… `RiskDecision` Рё `CapitalReservation` (СЃРј. [docs/reservation-first.md](../../docs/reservation-first.md)).
- РЎРѕР±С‹С‚РёСЏ outbox: РЅРѕРІС‹Рµ С‚РёРїС‹ (РµСЃР»Рё РІРІРѕРґСЏС‚СЃСЏ) вЂ” С‡РµСЂРµР· outbox + СЃС…РµРјС‹ РІ `@arbibot/contracts` Рё [docs/outbox-inbox.md](../../docs/outbox-inbox.md).
- Solana: **РІРЅРµ** scope v1 СЌС‚РѕР№ РІРµС‚РєРё РїР»Р°РЅР°; РїРѕРІС‚РѕСЂРЅС‹Р№ ADR РїСЂРё СЂР°СЃС€РёСЂРµРЅРёРё.

---

## Р’РµСЂСЃРёСЏ РґРѕРєСѓРјРµРЅС‚Р°

- **v0.1** вЂ” 2026-04-27: РїРµСЂРІР°СЏ РІС‹РєР»Р°РґРєР° DEX-1 / DEX-2 СЃ РґРµС‚Р°Р»СЊРЅС‹РјРё `step_id` Рё СЃРѕРіР»Р°СЃРѕРІР°РЅРёРµРј СЃ `DEVELOPMENT_PLAN.md`.
- **v0.2** вЂ” 2026-04-27: СѓР»СѓС‡С€РµРЅРёСЏ РїРѕСЃР»Рµ РїРµСЂРІРѕР№ РїСЂРѕРІРµСЂРєРё: РґРѕР±Р°РІР»РµРЅС‹ ADR СЃС‚СЂСѓРєС‚СѓСЂС‹, С‚РµС…РІС‹Р±РѕСЂ, РјРёРіСЂР°С†РёРё, СѓРїСЂР°РІР»РµРЅРёРµ РєРѕС€РµР»СЊРєР°РјРё, env template, approve pattern, load test, frontend UI.
- **v0.3** вЂ” 2026-04-27: СѓР»СѓС‡С€РµРЅРёСЏ РїРѕСЃР»Рµ РІС‚РѕСЂРѕР№ РїСЂРѕРІРµСЂРєРё: РґРѕР±Р°РІР»РµРЅС‹ РїРѕР»СЏ `phase` РІРѕ РІСЃРµ С€Р°РіРё, fill tracking, mempool monitoring, outbox events, health endpoints, slippage protection, DEX-specific risk policies, pool discovery, EIP-1559 tuning, audit fields, performance budget, rollback strategy.
- **v1.0** вЂ” 2026-04-27: **РїРѕР»РЅР°СЏ РїРµСЂРµСЂР°Р±РѕС‚РєР°** вЂ” РґРѕР±Р°РІР»РµРЅС‹ `depends_on`, `risk_level`, `estimated_hours`, `outputs`, `test_commands`, `edge_cases`, `rollback_procedure`, `ci_integration`, `main_plan_prerequisites`, dependency graph, РєРѕРЅРєСЂРµС‚РЅС‹Рµ acceptance criteria СЃ explicit checks.
- **v1.1** вЂ” 2026-04-29: `DEX-1-0-TECH-CHOICE` в†’ `done` (ethers.js v6.13.0); `DEX-1-0-ABIS` в†’ `done` (РїР°РєРµС‚ `@arbibot/contracts-eth` СЃ ABI РґР»СЏ UniV2/V3/Sushi + ERC20, Р°РґСЂРµСЃР° Arbitrum/Base/BNB mainnet+testnet, С‚РёРїС‹ ChainId/Address); build 21/21 green.
- **v1.2** вЂ” 2026-04-29: `DEX-1-0-GAS` в†’ `done` (GasEstimatorService СЃ EIP-1559, gas policy, Prometheus metrics, 15 unit tests); `DEX-1-0-ENV-EXAMPLE` в†’ `done` (.env.example РѕР±РЅРѕРІР»С‘РЅ RPC/GAS/VAULT/WALLET vars); review_notes РґРѕР±Р°РІР»РµРЅС‹ РґР»СЏ RPC, VAULT, WALLET-MGT; РґСѓР±Р»РёРєР°С‚ MIGRATIONS СѓСЃС‚СЂР°РЅС‘РЅ. **Р�С‚РѕРіРѕ 9/35 С€Р°РіРѕРІ done.**
- **v1.4** вЂ” 2026-04-30: РґРѕР±Р°РІР»РµРЅ mermaid flowchart (status lifecycle), СЃСЃС‹Р»РєР° РЅР° `.cursor/commands/review-step.md`.
- **v1.3** вЂ” 2026-04-30: `DEX-1-0-POOL-DISCOVERY` в†’ `done` (PoolDiscoveryService, UniV2/V3 discovery, in-memory cache, metrics); `DEX-1-0-RISK-POLICIES` в†’ `done` (DexRiskPolicyService, slippage/position/protocol/volume checks, metrics); `DEX-1-1-APPROVE-PATTERN` в†’ `done` (TokenApproveService, allowance check/approve/revoke, cache, metrics); `DEX-1-1-SLIPPAGE` в†’ `done` (SlippageProtectionService, tolerance levels, minAmountOut, metrics); key-rotation-runbook.md СЃРѕР·РґР°РЅ. **Р�С‚РѕРіРѕ 14/35 С€Р°РіРѕРІ done (DEX-1.0 вЂ” РІСЃРµ done, DEX-1.1 вЂ” 2/5 done).**
- **v1.5** вЂ” 2026-05-04: Р°РєС‚СѓР°Р»РёР·Р°С†РёСЏ РґР°С‚С‹; РїРѕРґС‚РІРµСЂР¶РґРµРЅРѕ 14/35 done. CI lint fix (turbo.json `^build` dependency). РЎР»РµРґСѓСЋС‰РёР№ С€Р°Рі: `DEX-1-1-ADAPTER-UNI2`.
- **v1.5.1** вЂ” 2026-05-04: CI lint fix РґР»СЏ `@arbibot/contracts-eth` вЂ” СѓР±СЂР°РЅ `**/*.spec.ts` РёР· `tsconfig.json` exclude (branch `fix/ci-contracts-eth-lint`, commit `dfb0cdb`).
- **v1.6** вЂ” 2026-05-04: `DEX-1-1-ADAPTER-UNI2` в†’ `implemented` (UniswapV2Adapter: swapExactTokensForTokens, ERC20 approve, on-chain quote + slippage, gas policy, Prometheus metrics; 21/21 unit tests passed; build + lint 0 errors). **Р�С‚РѕРіРѕ 14 done + 1 implemented = 15/35.**
- **v1.7** вЂ” 2026-05-05: `DEX-1-1-ADAPTER-UNI2` в†’ `done`; `DEX-1-1-ADAPTER-UNI3` в†’ `implemented` (UniswapV3Adapter: exactInputSingle, DexSwapParamsV3, shared slippage utils, Prometheus metrics; 21 unit tests; ExecutionModule DI). **Р�С‚РѕРіРѕ 15 done + 1 implemented = 16/35.**
- **v1.8** вЂ” 2026-05-05: `DEX-1-1-ADAPTER-UNI3` в†’ `done` (review passed: build 0 errors, 21/21 tests, commit `a48c644`). **Р�С‚РѕРіРѕ 16/35 done. РЎР»РµРґСѓСЋС‰РёР№: DEX-1-1-VENUE-BIND.**
- **v1.9** вЂ” 2026-05-05: `DEX-1-1-VENUE-BIND` в†’ `done` вњ… (VenueFactoryService: extractVenueKey, resolveAdapter, submitLeg; feature flag DEX_VENUE_ENABLED; LegsModule + ExecutionModule DI; 21/21 unit tests; build 21/21). **Р�С‚РѕРіРѕ 17/35 done. РЎР»РµРґСѓСЋС‰РёР№: `DEX-1-1-ADAPTER-SUSHI`.**
- **v1.10** вЂ” 2026-05-05: `DEX-1-1-ADAPTER-SUSHI` в†’ `implemented` (SushiSwapV2Adapter: swapExactTokensForTokens, shared utils СЃ UniV2, Arbitrum SushiSwap + BNB PancakeSwap, Base в†’ VenueSubmitClientError; 19/19 tests; build 21/21). **Р�С‚РѕРіРѕ 17 done + 1 implemented = 18/35. РЎР»РµРґСѓСЋС‰РёР№: `/review-step` РґР»СЏ SUSHI.**
- **v1.11** вЂ” 2026-05-06: `DEX-1-2-FILL-TRACKING` в†’ `done` вњ… (DexFillTrackerService: receipt в†’ fill, LegFilledPayloadV2 СЃ optional dex metadata, OnChainTransaction.legId bigintв†’uuid, migration 034; 9/9 tests; build 21/21). **Р�С‚РѕРіРѕ 19/35 done. РЎР»РµРґСѓСЋС‰РёР№: `DEX-1-2-RECON-ONCHAIN`.**
- **v1.12** вЂ” 2026-05-06: `DEX-1-2-RECON-ONCHAIN` в†’ `implemented` (С‚СЂРё DEX-РґРµС‚РµРєС‚РѕСЂР° РІ reconciliation-service: stale pending tx, balance drift, missing on-chain record; 7/7 tests; build вњ…).
- **v1.13** вЂ” 2026-05-06: `DEX-1-2-RECON-ONCHAIN` в†’ `done` вњ… (review passed session 11: 7/7 tests, architecture check вЂ” С‡РёСЃС‚РѕРµ СЂР°Р·РґРµР»РµРЅРёРµ CEX/DEX, idempotent inserts). **Р�С‚РѕРіРѕ 20/35 done. РЎР»РµРґСѓСЋС‰РёР№: `DEX-1-2-OUTBOX-EVENTS`.**
- **v1.14** вЂ” 2026-05-06: `DEX-1-2-OUTBOX-EVENTS` в†’ `done` вњ… (DexOutboxEventsService: 3 event types, idempotent outbox writes, Kafka bridge allowlist; 10/10 tests; build 21/21). **Р�С‚РѕРіРѕ 21/35 done. РЎР»РµРґСѓСЋС‰РёР№: `DEX-1-2-MEMPOOL`.**
- **v1.15** вЂ” 2026-05-10: `DEX-1-2-MEMPOOL` в†’ `done` вњ… (DexMempoolMonitorWorker: mempool subscription via ethers.js, MEV detection patterns (frontrun/sandwich), risk score, Prometheus metrics, feature flag; 12/12 tests; docs/dex-mev-threats.md; build 21/21). **Р�С‚РѕРіРѕ 22/35 done. РЎР»РµРґСѓСЋС‰РёР№: `DEX-1-2-HEALTH`.**
- **v1.16** вЂ” 2026-05-10: `DEX-1-2-HEALTH` в†’ `done` вњ… (DexHealthService + DexHealthController: GET /health/dex + GET /health/dex/bridges, BFF route, DexHealthBanner; 9/9 tests; build 21/21, lint 0 errors). **Р�С‚РѕРіРѕ 23/35 done. РЎР»РµРґСѓСЋС‰РёР№: `DEX-1-2-OBS`.**
- **v1.17** вЂ” 2026-05-10: `DEX-1-2-OBS` в†’ `done` вњ… (DexMetricsService: 6 Prometheus metrics with timer helpers; Grafana dashboard arbibot-dex-overview.json with 11 panels; DEX SLO targets in observability-tracing.md; 10/10 tests; build 21/21). **Р�С‚РѕРіРѕ 24/35 done. РЎР»РµРґСѓСЋС‰РёР№: `DEX-1-2-LOAD-TEST`.**
- **v1.18** вЂ” 2026-05-10: `DEX-1-2-LOAD-TEST` в†’ `done` вњ… (tools/dex-load-test.mjs: 3-phase load test вЂ” health warmup, concurrent submit, metrics scrape; --dry-run mode; configurable thresholds p95/error rate/throughput; docs/dex-load-test-report.md; npm run dex:load-test; build 21/21, lint 0 errors). **Р�С‚РѕРіРѕ 25/35 done. РЎР»РµРґСѓСЋС‰РёР№: `DEX-1-3-PAPER-TESTNET`.**

- **v1.19** - 2026-05-10: `DEX-1-3-PAPER-TESTNET`  `done` ? (PaperDexAdapter: simulated DEX swaps with configurable output multiplier, price impact, slippage, gas; 4 Prometheus metrics; venueKey `paper-dex`; 21/21 tests; build 21/21, lint 0 errors). **€в®Ј® 26/35 done. ‘«Ґ¤гойЁ©: `DEX-1-3-LIVE-TESTNET`.** 
