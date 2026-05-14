# DEX-1.3 — Операционная последовательность (paper/live)

> Все шаги в этом разделе → **`done`** ✅

---

## `DEX-1-3-PAPER-TESTNET` — Paper + testnet: виртуальные fills

- **step_id:** `DEX-1-3-PAPER-TESTNET`
- **status:** `done` ✅
- **review_passed_date:** 2026-05-10
- **depends_on:** [`P3-3-PAPER`, `DEX-1-1-ADAPTER-UNI2`]
- **outputs:** `PaperDexAdapter` (venueKey `paper-dex`), simulated swap output + gas cost, 4 Prometheus metrics; 21/21 tests

---

## `DEX-1-3-LIVE-TESTNET` — Live testnet: реальные tx

- **step_id:** `DEX-1-3-LIVE-TESTNET`
- **status:** `done` ✅
- **review_passed_date:** 2026-05-10
- **depends_on:** [`DEX-1-1-VENUE-BIND`, `DEX-1-2-FILL-TRACKING`]
- **outputs:** `tools/e2e-dex1-testnet.mjs`, `docs/dex-testnet-runbook.md`, полный цикл reserve → arm → DEX ноги → settlement

---

## `DEX-1-3-PAPER-MAINNET` — Mainnet paper

- **step_id:** `DEX-1-3-PAPER-MAINNET`
- **status:** `done` ✅
- **depends_on:** [`DEX-1-3-PAPER-TESTNET`]
- **outputs:** Drift metrics (`arb_paper_dex_drift_bps`, `arb_paper_dex_mainnet_trades_total`, `arb_paper_dex_mainnet_profit_usd`), Grafana dashboard `arbibot-dex-paper-mainnet.json`, `docs/dex-paper-mainnet-runbook.md`, feature flag `PAPER_DEX_MAINNET_ENABLED`; 24/24 tests

---

## `DEX-1-3-LIVE-MAINNET` — Mainnet live: минимальный капитал

- **step_id:** `DEX-1-3-LIVE-MAINNET`
- **status:** `done` ✅
- **review_passed_date:** 2026-05-11
- **depends_on:** [`DEX-1-3-PAPER-MAINNET`]
- **risk_level:** `critical`
- **outputs:** Migration `035_dex_live_limits_seed.sql` (seed `dex.limits` + `dex.live`), `docs/dex-live-mainnet-runbook.md` (two-person rule, rollback), env vars `DEX_LIVE_*`