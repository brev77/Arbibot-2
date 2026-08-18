# ТЗ: Pre-positioned cross-chain probe — exec_pp, окна возможностей, автопоиск фильтров (v4)

**Дата:** 18 августа 2026, 09:10 МСК
**Автор:** Hermes Agent · **Исполнитель:** ZCode (Cursor)
**Источники:** proposal ZCode (замеры 2026-08-17) + ТЗ Hermes v3 (части A/B/C в переработанном виде) + решения оператора от 2026-08-18 (секция 2 — приоритет при конфликте).

**Цель:** бот сам ищет настройки фильтров, при которых находятся межсетевые арбитражные возможности, и фиксирует каждую возможность отдельной записью. Данные — платный RPC (BlockPi). Режим — межсетевой. Капитал заранее распределён по кошелькам трёх сетей → мосты и маршруты обмена НЕ моделируются. Итерация 1 — карта «где деньги», с максимально мягким порогом.

**Вне скоупа (не делать):** исполнение сделок, мосты/маршруты, кошельки/ключи, ребаланс, EO/opportunity-service/risk/capital, live-торговля. Probe остаётся read-only standalone, kill-switch не трогается. MC3 к квотам не применяется (QuoterV2 non-view).

---

## 1. Опорные факты (код и БД, 2026-08-17)

| Факт | Значение | Источник |
|---|---|---|
| Модель издержек pre-positioned | газ двух ног, без моста: одна нога $0.002–0.01 → на $50 ≈ 0.8–4 bps, на $1000 ≤0.2 bps | receipts Arb/OP/Base + GasPriceOracle.getL1Fee |
| Мостовая метрика врёт для стратегии | canonical avg по нотионалам −18.5/−21.5/−925.7/−1168.3 bps (мост+slippage); OVER — все 4016 строк bridge=none | SQL по `metadata->'exec'` |
| Живой сигнал | OVER: 24 позитива/48ч, OP→Base, max +108.4 bps на $10, avg +63.2; очереди 2–3 цикла, гэпы ≤11 мин | SQL |
| `gas_cost_usd` | NULL в 100% строк (167K) — газа в модели нет | SQL |
| Multicall3 | задеплоен на Arb/Base/OP (3808 байт); `aggregate` работает на платном BlockPi (проверено: USDC decimals=6 на 3 сетях); `aggregate3` реверты — использовать `aggregate` | node+ethers smoke 2026-08-17 |
| Registry | Arb 282 / Base 1011 / OP 193 пулов; 8 связок dex×сеть; **Sushi: квотер и фабрики в коде есть (`probe-dry-run.mjs:90`, `probe-discovery.mjs:53,58`), пулов в registry 0** | SQL GROUP BY |
| LIMIT 500 | режет refresh снапшотов, Base покрыт 539/1011 | `probe-dry-run.mjs:365` |
| Циклы | нормальный 235–284 c, каждый 5-й со Stage 0 683–729 c → эффективный период ≈5.5 мин; ~2.6–3.1K RPC/цикл при 25 rps self-imposed | pm2-лог |
| Полоса $5M→$20M | +36 пулов (≤7% universe) | SQL по latest snapshots |
| Знаменатели exec-строк | у автора proposal 27,224 heuristic / 17,352 canonical — расходится с v3 (42,540/29,696) | SQL |
| Миграции | последняя 057; стиль: idempotent, `npm run db:migrate` | `infra/postgres/migrations/` |

---

## 2. Решения оператора (2026-08-18, обязательны, приоритет над остальными секциями)

1. **Нотионалы: {50, 100} для детектора + 1000 информационно.** Сетка квот Phase 2 = `50/100/1000`; детектор окон смотрит 50/100; 1000 — только глубина (`net_bps_at_1000`), окна не открывает. $10 из сетки убираем.
2. **Порог детектора: `net_pp_bps > 0`** — минимально положительное ПОСЛЕ газа (газ внутри метрики). Floor = 0, не 1 bps: итерация 1 не должна терять окна.
3. **Sanity-гейт — неканонический:** не блокирует сбор. Если canonical WETH/USDC на $50/$100 уходит за ±50 bps → строка-алерт в дайджесте. $1000+ не проверяем (там доминирует честный slippage). suspicious-строки пишутся в БД с пометкой.
4. **Ось бирж в тюнере:** `venue_pair` — обязательная ось FilterLab (venue каждой ноги пишет фаза A). Расширение списка бирш — после итерации 1, по данным (где эджи живут); кандидатуры: PancakeSwap V3 Base, Ramses Arb, Sushi Base/OP.
5. **Сверка старое/новое при приёмке — только на bridge-NULL строках** (новое = старое − газ); для Across-строк не проверяем.

---

## 3. Фаза A — метрика exec_pp + контекст при записи + газ (~0.5–1 день, предусловие для B/C)

### A1. Миграция `058_exec_pp_and_opportunities.sql` (часть 1)

```sql
-- 058: exec_pp колонка + run stats (idempotent, стиль дома)
ALTER TABLE dry_run_cross_chain_observations
  ADD COLUMN IF NOT EXISTS net_pp_bps NUMERIC(10,4);

CREATE TABLE IF NOT EXISTS dry_run_run_stats (
  id               BIGSERIAL PRIMARY KEY,
  run_id           UUID NOT NULL,
  chain_id         INT NOT NULL,
  gas_price_gwei   NUMERIC(12,6) NOT NULL,
  l1_fee_eth       NUMERIC(18,12),        -- NULL на Arb
  gas_eth_smoothed NUMERIC(18,12) NOT NULL, -- медиана 3 последних сэмплов цепи
  eth_usd          NUMERIC(12,4) NOT NULL,
  rpc_calls        INT NOT NULL,
  cycle_ms         INT NOT NULL,
  cold_tier_skipped BOOLEAN NOT NULL DEFAULT FALSE, -- RPC-guard сработал
  observed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, chain_id)
);
CREATE INDEX IF NOT EXISTS idx_run_stats_time ON dry_run_run_stats (observed_at DESC);
```

### A2. Газ-сэмпл каждый цикл × сеть (2 RPC)

`eth_gasPrice` + `getL1Fee(канонический swap-calldata 260B)` через GasPriceOracle `0x42000000000000000000000000000000F` на Base/OP (Arb: L1 пренебрежим, 261 gas). Модель: `gas_eth = gasPrice × 150_000 + l1_fee`, USD по WETH-прайсу probe. Калибровано receipts (135,586 gas Arb / 113,089 OP), погрешность ≤±20% → ≤±0.4 bps на $100.

**Сглаживание (обязательное):** `gas_eth_smoothed` = медиана текущего + 2 предыдущих сэмплов цепи из `dry_run_run_stats`. В метрику идёт сглаженный; мгновенный остаётся в run_stats. Причина: спайки gasPrice (Arb 0.02→0.5 gwei) ложно убивают окна.

### A3. exec_pp в Phase 2 (`runCycleCrossChain`, `probe-dry-run.mjs:503-570`)

- Сетка нотионалов: **{50, 100, 1000}** (замена текущей).
- Обе ноги через лучший venue из registry (реюз `quoteVenue`, не только UniV3): USDC→токен в сети покупки, токен→USDC в сети продажи. Без моста.
- `net_pp_bps = ((sell_usd_out − usd_in) / usd_in) · 10⁴ − gas_bps(buy) − gas_bps(sell)`, gas из сглаженного сэмпла.
- **Клэмп мусора:** |net_pp_bps| > 99999 → клэмп (урок price_diff / миграции 057); исходное значение — в metadata `net_pp_raw` для диагностики. Один скам-токен не роняет INSERT-батч.
- Мостовой `metadata.exec` остаётся для сравнения.

### A4. Контекст при INSERT (0 доп. RPC — данные цикла уже в памяти)

`metadata`: `token_tvl_buy_usd`, `token_tvl_sell_usd`, `tvl_band`, `pool_age_hours` (из `created_at_block` × block-time; NULL → unknown), `gas_bps_buy/sell`, `venue_buy`, `venue_sell`, `sweep_variant` (фаза D). TVL — пул, через который реально квотили (точнее proxy-максимума).

### DoD A

1. Миграция 058 накатывается, повторный запуск не падает.
2. 2+ цикла: `net_pp_bps` и контекст заполнены ≥90% не-suspicious строк. **Сверка с прошлой метрикой — только bridge-NULL строки: `net_pp_bps ≈ exec.net_bps − gas_bps`** (решение оператора п.5). SQL-проверка в DoD: медиана расхождения |net_pp − (exec − gas)| ≤ 1 bps на OVER-строках.
3. `run_stats` пишется каждый цикл×сеть, все NOT NULL заполнены.
4. Sanity (неканонический): `SELECT` canonical WETH/USDC $50/$100 — все в ±50 bps; нарушение = строка-алерт в дайджест, НЕ блок записи.
5. Клэмп: инжект фикстуры +200000 bps → записан как 99999 + `net_pp_raw`; батч не упал.
6. `node --test`: gas_bps из run_stats на фикстурах; клэмп; формула exec_pp.

---

## 4. Фаза B — детектор окон `dry_run_arb_opportunities` (~1 день)

### B1. Миграция 058 (часть 2)

```sql
CREATE TABLE IF NOT EXISTS dry_run_arb_opportunities (
  id                BIGSERIAL PRIMARY KEY,
  token             TEXT NOT NULL,
  token_addr_buy    TEXT NOT NULL,
  token_addr_sell   TEXT NOT NULL,
  buy_chain_id      INT NOT NULL,
  sell_chain_id     INT NOT NULL,
  trust             TEXT NOT NULL,
  first_seen        TIMESTAMPTZ NOT NULL,
  last_seen         TIMESTAMPTZ NOT NULL,
  samples           INT NOT NULL DEFAULT 1,      -- наблюдений окна (НЕ циклы: hot/cold ломает семантику)
  run_ids           TEXT[] NOT NULL DEFAULT '{}',
  net_bps_at_50     NUMERIC(10,2),
  net_bps_at_100    NUMERIC(10,2),
  net_bps_at_1000   NUMERIC(10,2),               -- информационно, глубина
  gas_bps_last      NUMERIC(10,2),
  best_net_bps      NUMERIC(10,2) NOT NULL,
  best_notional_usd NUMERIC(20,2) NOT NULL,
  max_notional_positive NUMERIC(20,2) NOT NULL,  -- монотонно; квалификация окна ≥ 50
  venue_pair        TEXT,                        -- 'aerodrome-v2>uniswap-v3'
  bridge_fee_bps_last NUMERIC(10,4),             -- справочно, НЕ гейт
  tvl_buy_usd_last  NUMERIC(20,4),
  tvl_sell_usd_last NUMERIC(20,4),
  filter_config_id  BIGINT,                      -- FK на 059 после C; nullable
  status            TEXT NOT NULL DEFAULT 'open',
  expired_at        TIMESTAMPTZ,
  UNIQUE (token_addr_buy, token_addr_sell, buy_chain_id, sell_chain_id, first_seen)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_arb_opp_open
  ON dry_run_arb_opportunities (token_addr_buy, token_addr_sell, buy_chain_id, sell_chain_id)
  WHERE status = 'open';                          -- паттерн 050
CREATE INDEX IF NOT EXISTS idx_arb_opp_token ON dry_run_arb_opportunities (token, last_seen DESC);
```

### B2. Stage 3 в `runOnce()` (`probe-dry-run.mjs:741-765`, после Stage 2) — чистый SQL, 0 RPC

1. SELECT наблюдений run_id: `net_pp_bps > 0 AND notional_usd IN (50,100) AND trust != 'suspicious'`.
2. UPSERT: open-строка того же маршрута с `last_seen > now() − 30 мин` → обновить (last_seen, `samples+1`, run_ids append, перезапись `net_bps_at_*`, best_* max-семантика, `max_notional_positive` монотонно); иначе INSERT. $1000-наблюдение окно НЕ открывает, но дописывается в существующее (`net_bps_at_1000`, max_notional_positive).
3. Expire: open с `last_seen < now() − 30 мин` → `status='expired', expired_at=now()`. Окно 30 мин = OVER-очереди (≤11 мин) ×3; перекалибровка через неделю по распределению длительностей.

### B3. Дайджест `tools/arb-digest.mjs [--hours 24]` (~60 строк, SELECT-only)

Open+expired за окно, группировка по токенам/маршрутам/venue_pair, топ по `best_net_bps` и глубине, `unverified sell-side` для токенов без dex-obs sell-истории, **строки-алерты sanity** (п.2 решений п.3). Запуск руками/расписанием оператора — бот сам не шлёт.

### DoD B

1. Миграция idempotent.
2. Mechanics-смоук: временно порог −1000 → строки появляются → вернуть 0.
3. Два подряд наблюдения одного маршрута → одна строка, samples=2.
4. Expiry срабатывает (`now()` подмена/тест-функция).
5. `node --test` чистой функции `matchOpportunity(existing, obs)`.
6. Дайджест: на synthetic-данных показывает группировку и sanity-алерт.
7. $1000-наблюдение не открывает новое окно (фикстура).

---

## 5. Фаза C — FilterLab: офлайн grid-search (~1–1.5 дня; код параллельно с B, гонять после ≥48–72ч данных после-A)

### C1. Миграция `059_filter_experiments.sql`

```sql
CREATE TABLE IF NOT EXISTS dry_run_filter_experiments (
  id                BIGSERIAL PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_from       TIMESTAMPTZ NOT NULL,
  window_to         TIMESTAMPTZ NOT NULL,
  filter_config     JSONB NOT NULL,          -- значения осей комбинации
  config_hash       TEXT NOT NULL,           -- sha1(canonical json)
  split             TEXT NOT NULL,           -- 'train' | 'validate'
  denominator_rule  TEXT NOT NULL,           -- как считался obs_total (exec_pp-строки, не-suspicious, нотионалы 50/100)
  obs_total         INT NOT NULL,
  obs_positive      INT NOT NULL,            -- net_pp_bps > 0
  obs_positive_tokens INT NOT NULL,          -- DISTINCT token среди позитивов
  positive_rate     NUMERIC(8,6) NOT NULL,
  median_net_bps    NUMERIC(10,2),
  avg_net_bps       NUMERIC(10,2),
  max_notional_positive NUMERIC(20,2),
  opportunities_detected INT,                -- join окон после B
  verdict           TEXT NOT NULL,           -- promising | single-incident | dead | no-data
  notes             TEXT,
  UNIQUE (config_hash, window_from, split)
);
CREATE INDEX IF NOT EXISTS idx_filter_exp_verdict ON dry_run_filter_experiments (verdict, positive_rate DESC);
```

### C2. `tools/filter-lab.mjs` (~300 строк, 0 RPC)

Оси (кастомизируются `--tvl-bands "5e4:1e5,1e5:5e5"` и т.п.):
- `tvl_band` [1K,10K)…[5M,20M) — источники `metadata.token_tvl_buy/sell` (min из двух ног);
- `vol24h_band` [0,100)…[100K,∞);
- `trust` canonical/heuristic;
- `pool_age` <24h / 24h–7d / >7d / unknown;
- `direction` 6 направлений;
- **`venue_pair`** — из metadata (решение оператора п.4; ~8 связок → до ~15 пар).

Источник: `net_pp_bps` + контекст фазы A (плоский GROUP BY, LATERAL не нужен). До-A история не анализируется.

Хронологический сплит 70/30: каждая комбинация × сплит = строка. Вердикты:
- `promising` — positive_rate ≥ 0.1% И `obs_positive_tokens ≥ 2` И `max_notional_positive ≥ 50` **на train И validate**;
- `single-incident` — позитивы есть, токен 1 (OVER-инцидент обязан попасть сюда — тест оверфит-гейта);
- `dead` — obs_total ≥ 1000, 0 позитивов; иначе `no-data`.

CLI: `--from --to --report` (топ-20 на консоль).

### DoD C

1. Миграция idempotent.
2. После ≥48ч после-A данных прогон < 60 c, > 100 строк.
3. OVER-инцидент → `single-incident`, не `promising` (механический тест вместо DoD v3 «бакет обязан дать promising»).
4. `node --test` метрик на фикстурах.
5. `--report` читаем.

---

## 6. Фаза D — sweep: query-time, без мутации eligible (~0.5 дня)

Конфиг `probe-config.json`: `sweep { enabled:false, variants:[{id, tvlMinUsd, tvlMaxUsd, poolAgeMaxHours?}], rotateEveryCycles:3 }`.

- Variant применяется в eligibility-CTE Phase 2 (последний snapshot, `tvl_usd BETWEEN bounds`) — **никаких UPDATE eligible** (общий с Phase 1 + time-series портится).
- `metadata.sweep_variant` в каждую cc-строку. Лог `[sweep] cycle N → variant=X`.
- Конффаунд ротации (variant≡время) — пометка в `--report`.

### DoD D

1. Ротация в логе, ≥2 значений sweep_variant за час. 2. RPC/цикл ±20%. 3. Без флага поведение идентично (sweep_variant NULL). 4. Регресс-гейт: `snapshots.eligible` не меняется ротацией.

---

## 7. Фаза E — RPC-эффективность и охват (параллельно B/C, ~1–1.5 дня)

1. **Multicall3-батчинг Stage 0** view-чтений (`aggregate`, НЕ aggregate3 — реверты; батчи ~50 пулов; квоты НЕ батчим).
2. **Снять `LIMIT 500`** (`probe-dry-run.mjs:365`) → весь registry (Base 1011 ≈ 25 MC3-вызовов на refresh).
3. **Collect-полоса $1K–$20M** (отдельно от детекторных порогов; +36 пулов).
4. **Hot/cold кадence:** hot (открытые окна + токены с недавним `net_pp_bps ≥ 25`) — каждый цикл; cold — каждый 3-й. **Токен с edge в cold-цикле становится hot в этом же цикле** (семантика samples не ломается). Снимает алиасинг 5.5 мин на живых токенах.
5. **RPC-guard:** `rpc_calls` цикла > P95×1.5 (P95 по run_stats за 24ч) → пропуск cold-тира, `cold_tier_skipped=TRUE` в run_stats. Потолок тарифа BlockPi проверить в дашборде до подъёма rps.
6. **Sushi-синк:** фабрики в `probe-discovery.mjs:53,58` и квотер `probe-dry-run.mjs:90` есть, registry 0 пулов — диагностировать и починить заливку (дешёвое расширение охвата).
7. Newborn-пробинг solidly/slipstream (Aerodrome `getPool(a,b,stable)`, Slipstream `getPool(a,b,int24)`).

### DoD E

Stage-0 циклы ≤1.5× нормального; снапшоты покрывают весь registry (Base ~1011); rpc_calls стабилен после расширения; hot-токены в соседних циклах; Sushi-пулы в registry > 0 (или root cause почему 0 — отчётом).

---

## 8. Порядок работ

**A (0.5–1 д) → B (1 д) → C (1–1.5 д, гонять после 48–72ч после-A данных) → D (0.5 д); E параллельно (1–1.5 д).** Итого ~4–5 дней. A+B = миграция 058; C = 059.

## 9. Риски и митигации

| Риск | Митигация |
|---|---|
| Разгон данных: сплит C не раньше 48–72ч после A | `no-data`/`single-incident` первые дни — норма, не провал |
| Редкость: 24 позитива/48ч на 1 токене; promising может быть 0–2 | Ответ рынка, не баг; sweep (D) + полоса $5–20M (E) расширяют; отсутствие конфигов = валидная фальсификация |
| Honeypot: exec-квота ≠ продаваемость | trust-гейты + `unverified sell-side` в дайджесте |
| Окно 30 мин — гипотеза | перекалибровка через неделю по распределению длительностей |
| Суб-минутные окна — слепая зона | фиксируется честно в отчётах; hot-кадence (E4) сжимает до ~5.5 мин на живых |
| Газ-спайки ложно закрывают окна | медиана-3 (A2); мгновенный сэмпл сохраняется для диагностики |
| Arb factory-getLogs молчит | если incremental-sync на Arb не даёт событий — отдельная диагностика, не блокер фаз |
| Мусорные котировки роняют батч | клэмп + net_pp_raw (A3) |

## 10. Критерии приёмки всего ТЗ

- Детектор открывает окна при любом положительном net_pp_bps после газа на $50/$100 — итерация 1 теряет ноль валидных окон.
- Каждая возможность — строка с жизненным циклом open→expired, глубиной, venue_pair, samples.
- FilterLab отвечает «какие настройки находят деньги» вердиктами с числами, включая ось venue_pair; OVER-инцидент классифицируется single-incident.
- RPC-бюджет под контролем: run_stats на каждый цикл, guard на P95×1.5.
- Всё idempotent, с node --test на чистой логике, EO/opp/risk/capital не тронуты, kill-switch не менялся.
