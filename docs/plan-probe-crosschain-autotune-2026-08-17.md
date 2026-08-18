# План PLAN14 — probe: pre-positioned метрика, окна возможностей, автопоиск фильтров

> **Назначение:** реализация директивы оператора (2026-08-17): бот **сам ищет настройки
> фильтров**, при которых находятся межсетевые арбитражные возможности, и фиксирует каждую
> возможность отдельной записью. Стратегия **pre-positioned**: капитал заранее распределён по
> кошелькам трёх сетей → мосты и маршруты обмена не моделируются; только поиск и фиксация.
> План — мерж proposal ZCode + ТЗ Hermes v3/v4 + ревью ZCode (правки D1–D4).
>
> **Связанные документы:**
> - ТЗ Hermes v4 — [`docs/tz-cross-chain-probe-autotune-v4-2026-08-18.md`](tz-cross-chain-probe-autotune-v4-2026-08-18.md); v3 — [`docs/tz-cross-chain-filter-search-2026-08-17.md`](tz-cross-chain-filter-search-2026-08-17.md)
> - Стратегический каркас и канонический реестр инициатив — [`docs/roadmap-vectors.md`](roadmap-vectors.md) (#52–#57)
> - Инструмент — [`tools/probe-dry-run.mjs`](../tools/probe-dry-run.mjs), [`tools/probe-discovery.mjs`](../tools/probe-discovery.mjs), [`tools/probe-dry-run-README.md`](../tools/probe-dry-run-README.md); миграции 055–057
> - Предыдущий план — [`docs/plan-slippage-same-decimals-2026-08-10.md`](plan-slippage-same-decimals-2026-08-10.md) (PLAN13)
>
> **Эта документация — живая.** Все `file:line` верифицированы чтением кода, все замеры —
> SQL по живой БД Aéza и on-chain smoke (BlockPi + публичные RPC) на дату составления
> (2026-08-17/18). При изменении кода — обновить этот файл по принципу P2.

---

## 1. Контекст

### 1.1 Директива и стратегия

Директива оператора (2026-08-17): данные собираются с платного RPC (BlockPi, 3 сети);
режим межсетевой; поиск и фиксация возможностей — исполнение, кошельки, мосты/маршруты,
ребаланс вне скоупа. Probe — read-only standalone-инструмент (`tools/probe-dry-run.mjs`),
живой на Aéza с 2026-08-14; paper-стек остановлен (решение оператора 2026-08-17), работаем
только с probe. Итерация 1 — карта «где деньги» с максимально мягким порогом.

Эмпирическое обоснование стратегии: единственный устойчивый живой сигнал за всю историю
наблюдений — OVER (transient-дислокации ~1%, очереди 2–3 цикла), при этом 66.96% межсетевых
арбитражников работают из pre-positioned инвентаря, а не через мосты (research 2026-08-12).

### 1.2 Разрывы текущего кода (верифицировано чтением)

| Разрыв | Где | Следствие |
|---|---|---|
| Honest-math Phase 2 — **мостовой** (fee Across внутри) | `probe-dry-run.mjs:611-634` | Метрика не соответствует pre-positioned стратегии: мостовые токены оштрафованы на 2–10+ bps, немостовые (OVER, `bridge_fee_bps` NULL) — нет; непоследовательно |
| Газ не учитывается | `gas_cost_usd` всегда NULL (`:485`); gasPrice не сэмплируется | На $50 нотионале газ = 0.8–4 bps, на $10 был бы 4–20 bps — метрика без газа искажает порог |
| Phase 2 квотирует только UniV3 (+WETH-fallback) | `quoteUsdToUnits`/`quoteUnitsToUsd`, `:710-738` | Long-tail токены, живущие только на Aerodrome/Velodrome, выпадают из exec |
| Фильтры статичны, применяются при сборе | `probe-config.json:37-41`; eligible-флаг | Истории вне полосы нет — автонастройке не по чему искать |
| Нет сущности «возможность» | миграции 055–057 | Только сырые строки наблюдений, без окон/длительностей/направлений |
| Liquidity refresh `LIMIT 500`, посерийные чтения | `refreshLiquidityForChain`, `:363-419` | Base покрыт 539/1061; Stage-0 циклы ×3 длиннее → эффективный период ~5.5 мин (алиасинг) |
| Sushi: фабрики в коде, пулов в registry 0 | `probe-discovery.mjs:53,58`; registry-запрос | Дыра покрытия; в `FACTORIES` нет sushi-фабрики для OP вовсе |
| Newborn-пробинг solidly/slipstream не настроен | `probe-discovery.mjs:67-71` | Новые тонкие пулы ловит только периодический ре-сит DefiLlama |

### 1.3 Верифицированные факты и замеры (2026-08-17/18)

| Факт | Значение | Метод |
|---|---|---|
| Газ pre-positioned | одна нога $0.002–0.01: Arb 135,586 gas × 0.020 gwei; OP 113,089 × 0.020 + L1 1.7e-9 ETH; Base ≈0.8e-6 ETH + L1 1.0e-9. На $50 ≈ 0.8–4 bps, на $1000 ≤0.2 bps | receipts USDC/WETH-0.05% |
| Газ-прекомпайлы | `GasPriceOracle 0x420000000000000000000000000000000000000F.getL1Fee(calldata)` — точная L1-компонента на Base/OP; `overhead()`/`scalar()` удалены post-Ecotone; Arb L1-доля пренебрежима (261 gas) | eth_call on-chain |
| Multicall3 | `0xcA11bde05977b3631167028862bE2a173976CA11` задеплоен на Arb/Base/OP; `aggregate` работает на платном BlockPi; **`aggregate3` реверты на всех 3 сетях** — использовать только `aggregate` | smoke на BlockPi |
| Мостовая метрика врёт | canonical avg −18.6/−22.7/−926.4/−1165.7 bps (нотионалы 10/100/1000/10000); OVER 5704/5704 строк bridge=none; `gas_cost_usd` NULL в 100% (529,800 строк) | SQL Aéza |
| Живой сигнал | OVER: 24 позитива/48ч, OP→Base, max +108.4 bps на $10, ~+63 bps на $100, макс. нотионал позитива $100; очереди 2–3 цикла, гэпы ≤11 мин | SQL Aéza |
| Registry / покрытие | Arb 282 (236 univ3 + 46 camelot) / Base 1061 (753+138+170) / OP 196 (79+104+13); **sushiswap-v2 = 0**; eligible 118/326/58 при снапшотах 170/539/91 | SQL Aéza |
| Циклы | нормальный 235–284 c, каждый 5-й со Stage 0 683–729 c → ~250 циклов/сутки; ~2.6–3.1K RPC/цикл при 25 rps самоналоженных (потолок BlockPi-тарифа не проверен) | pm2-логи |
| Полоса $5M→$20M | +36 пулов на три сети (≤7% universe) — расширение почти бесплатно | SQL Aéza |
| BlockPi getLogs | archive-стены нет до 400K блоков при пагинации ≤5K (Base возвращает реальные PoolCreated на макс. глубине); широкий запрос одним выстрелом — `-32602` | smoke с сервера |
| Swap-getLogs (адрес-лист) | ~100 адресов в одном eth_getLogs + topic0-OR `[[v3,v2]]`: работает на BlockPi, все 3 сети — **0.1–0.35 c, 0.2–0.4 MB за 5-мин окно** (Base 441 лог, топ-100 по TVL; смоук 2026-08-18 по ревью Hermes №2); NB: в ethers `[A, B]` = topic0=A **И** topic1=B, OR-форма — `[[A, B]]` | smoke с сервера |

---

## 2. Решения оператора (2026-08-18) и поправки ревью

Решения оператора обязательны, приоритет над остальными секциями:

1. **Нотионалы детектора {50, 100}, 1000 — информационно** (глубина, окна не открывает).
   Поправка ревью: сетки разведены в конфиге — `phase1.notionalsUsd` остаётся
   {10,100,1000,10000} (сравнимость dex-obs истории), `phase2.notionalsUsd` = {50,100,1000}.
2. **Порог детектора `net_pp_bps > 0`** после газа (floor 0 — итерация 1 не теряет окон).
   Поправка ревью: диагностика ложных окон от внутрициклового скея квот ног —
   `block_buy`/`block_sell` в metadata (#52) + пометка `skew-suspect` в дайджесте (#53).
3. **Sanity-гейт неканонический, non-blocking:** canonical WETH/USDC на $50/$100 за ±50 bps
   → строка-алерт в дайджесте; $1000+ не проверяем (там доминирует честный slippage — §1.3).
4. **`venue_pair` — обязательная ось FilterLab.** Расширение списка бирж (Pancake V3 Base,
   Ramses Arb, Sushi Base/OP) — после итерации 1, по данным. NB: для OP sushi-фабрики нет в
   коде вовсе — сначала добавить адрес + on-chain верификация (#57).
5. **Сверка старое/новое — только bridge-NULL строки.** Поправка D1: сабсет дополнительно
   ограничен `venue_buy=venue_sell='uniswap-v3'` (старый exec квотил только UniV3; расхождение
   на других venue = легитимное улучшение, фиксируется отчётной метрикой `venue_improvement_bps`,
   не гейтом).
6. **Полная вселенная (решение оператора, 2026-08-18):** «все токены проанализированы вне
   зависимости от ликвидности; из подключённых источников информации не ускользает ничего;
   деньги ищутся из сырой информации». **Полоса сбора ликвидности упраздняется** (заменяет
   collect-полосу $1K–$20M из первоначальной версии #57): сбор становится сырьевым
   (MC3-чтения всех живых пулов), честные квоты на нотионале — только по триггеру из сырья;
   ликвидность — только ось анализа FilterLab, не фильтр сбора. Вселенная Phase 2
   переключается на **trigger-driven**. Реализация: #57 расширен сырьевым тиром, добавлено
   #58 (событийные триггеры), #54 усилен аналитикой сырого ряда и coverage-аудитом (#3/#4
   из предложений). Порог `raw.triggerBps` (25) — **стартовый**: после ≥48 ч сырья
   калибруется по распределению «сколько токенов триггерится на 10/15/25 bps» (ревью
   Hermes №1); полнота итерации 1 ограничена порогом сырья снизу — граница метода,
   зафиксирована в рисках, не скрывается.

Правки ревью v4 (вшиты): **D2** — GasPriceOracle `0x420000000000000000000000000000000000000F`
(checksummed; в v4 была опечатка); **D3** — `run_ids` distinct-append, $1000-позитив не продлевает
`last_seen` (осознанная семантика); **D4** — `run_stats.run_id` TEXT, как во всех dry_run-таблицах.

Методологические правила: тюнить только по venue-квотам на нотионале (никогда по маргинальным
ценам — фантомные гэпы); правило знаменателя фиксируется в схеме эксперимента; отсутствие
положительных конфигов — валидный результат (фальсификация), не провал инструмента.

---

## 3. Принципы (наследуются из roadmap-vectors.md)

Соблюдаем P1–P5 из [`docs/roadmap-vectors.md`](roadmap-vectors.md) §1. Ключевые:

- **P1 — код/замер источник истины:** все разрывы §1.2 верифицированы чтением кода с
  `file:line`; все числа §1.3 получены SQL/on-chain, а не из других доков.
- **P3 — один основной вектор на инициативу:** реестр §4; каждая инициатива закрывает одну
  главную ценность (метрика / фиксация / автопоиск / эффективность / покрытие).
- **P5 — реестр не дублирует трекер:** канонический реестр инициатив живёт в
  `roadmap-vectors.md`; здесь — только выдержка PLAN14.

---

## 4. Реестр инициатив (выдержка PLAN14; канон — roadmap-vectors.md §5)

| # | step_id | Вектор(ы) | gate | tracker | impact | effort | score | status | plan |
|---|---------|-----------|------|---------|--------|--------|-------|--------|------|
| 52 | `FUNC-PROBE-EXEC-PP` | FUNC | paper-check | new | 5 | 2 | 20 | accepted | PLAN14 |
| 53 | `FUNC-PROBE-OPPORTUNITY-WINDOWS` | FUNC | paper-check | new | 4 | 2 | 16 | accepted | PLAN14 |
| 54 | `FUNC-PROBE-FILTER-LAB` | FUNC | paper-check | new | 5 | 2 | 20 | accepted | PLAN14 |
| 55 | `FUNC-PROBE-SWEEP` | FUNC | paper-check | new | 3 | 1 | 15 | accepted | PLAN14 |
| 56 | `REL-PROBE-RPC-EFFICIENCY` | REL (PERF) | paper-check | new | 4 | 2 | 16 | accepted | PLAN14 |
| 57 | `FUNC-PROBE-COVERAGE` | FUNC (REL) | paper-check | new | 5 | 3 | 15 | accepted | PLAN14 — полная вселенная + сырьевой тир |
| 58 | `FUNC-PROBE-EVENT-TRIGGERS` | FUNC (PERF) | paper-check | new | 4 | 2 | 16 | accepted | PLAN14 |

**Легенда:** `gate: paper-check` — приёмка на живом стенде probe (Aéza), не трогает
live-стек. `score = impact × (6 − effort)`. `status`: proposed → **accepted** (2026-08-18)
→ in-progress → review → done.

---

## 5. Детализация инициатив

### #52. `FUNC-PROBE-EXEC-PP` — метрика exec_pp + контекст при записи + газ

| Поле | Значение |
|------|----------|
| **Вектор** | FUNC (честная метрика pre-positioned стратегии), вторичный TEST |
| **gate / impact / effort / score** | paper-check / 5 / 2 / 20 |
| **Корневые файлы** | `tools/probe-dry-run.mjs` (`runCycleCrossChain`, `:503-738`), миграция `058` ч.1 |
| **Предусловие для** | #53, #54, #55 — вся математика ниже идёт на `net_pp_bps` |

#### Решение

**Миграция 058, часть 1:**

```sql
ALTER TABLE dry_run_cross_chain_observations
  ADD COLUMN IF NOT EXISTS net_pp_bps NUMERIC(10,4);

CREATE TABLE IF NOT EXISTS dry_run_run_stats (
  id                BIGSERIAL PRIMARY KEY,
  run_id            TEXT NOT NULL,               -- как в остальных dry_run-таблицах (D4)
  chain_id          INT NOT NULL,
  block_number      BIGINT NOT NULL,             -- блок цикла → block_buy/block_sell в metadata
  gas_price_gwei    NUMERIC(12,6) NOT NULL,
  l1_fee_eth        NUMERIC(18,12),              -- NULL на Arb (L1 пренебрежим: 261 gas)
  gas_eth_smoothed  NUMERIC(18,12) NOT NULL,     -- медиана 3 последних сэмплов цепи
  eth_usd           NUMERIC(12,4) NOT NULL,
  rpc_calls         INT NOT NULL,
  cycle_ms          INT NOT NULL,
  cold_tier_skipped BOOLEAN NOT NULL DEFAULT FALSE,
  source            TEXT NOT NULL DEFAULT 'cycle', -- 'cycle' | 'event' (#58; ревью №3): event-проходы пишутся с синтетическим run_id 'event-<uuid>'
  observed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, chain_id)
);
CREATE INDEX IF NOT EXISTS idx_run_stats_time ON dry_run_run_stats (observed_at DESC);
```

**Газ-сэмпл каждый цикл × сеть** (3 RPC/сеть: `eth_gasPrice`, `eth_blockNumber`, Base/OP —
`getL1Fee(канонический swap-calldata 260B)` через GasPriceOracle `0x420000000000000000000000000000000000000F`).
Модель: `gas_eth = gasPrice × 150_000 + l1_fee`, USD по собственному WETH-прайсу probe
(калибровано receipts, погрешность ≤±20% → ≤±0.4 bps на $100). **Сглаживание обязательное:**
в метрику идёт медиана текущего + 2 предыдущих сэмплов цепи; мгновенный хранится в run_stats.
Причина: спайки gasPrice (Arb 0.02→0.5 gwei) ложно закрывают окна.

**exec_pp в Phase 2:** сетка `phase2.notionalsUsd` = {50,100,1000}; обе ноги через лучший
venue из registry (реюз `quoteVenue`, не только UniV3): USDC→токен (сеть покупки) +
токен→USDC (сеть продажи), без моста:
`net_pp_bps = ((sell_usd_out − usd_in)/usd_in)·10⁴ − gas_bps(buy) − gas_bps(sell)` (сглаженный газ).
Клэмп мусора: |net_pp_bps| > 99999 → 99999 (урок миграции 057), исходное в `metadata.net_pp_raw`.
Мостовой `metadata.exec` остаётся для сравнения.

**Контекст при INSERT** (0 доп. RPC — данные цикла уже в памяти) в `metadata`:
`token_tvl_buy_usd`, `token_tvl_sell_usd` (пул, через который реально квотили), `tvl_band`,
`pool_age_hours` (`created_at_block` × block-time; NULL → unknown), `gas_bps_buy/sell`,
`venue_buy`, `venue_sell`, `block_buy`, `block_sell`, `sweep_variant` (#55). Блоки ног —
**approximate** (ревью Hermes №9): `eth_call` не возвращает номер блока, пишется блок цикла
из `run_stats.block_number` на каждую сеть; skew-анализ #53 не претендует на субцикловую
точность.

#### DoD

- [ ] Миграция 058 накатывается `npm run db:migrate`, повторный запуск не падает.
- [ ] 2+ цикла: `net_pp_bps` и контекст ≥90% не-suspicious строк.
- [ ] Сверка (решение п.5 + D1): на сабсете bridge-NULL × `venue_buy=venue_sell='uniswap-v3'`
      медиана |net_pp − (exec.net_bps − gas)| ≤ 1 bps; на остальных bridge-NULL строках —
      отчётная `venue_improvement_bps` (не гейт).
- [ ] `run_stats` пишется каждый цикл×сеть, все NOT NULL заполнены (вкл. `block_number`).
- [ ] Sanity (решение п.3): canonical WETH/USDC $50/$100 — все в ±50 bps; нарушение =
      строка-алерт в дайджест, НЕ блок записи.
- [ ] Клэмп: фикстура +200000 bps → записан 99999 + `net_pp_raw`, INSERT-батч жив.
- [ ] `node --test`: gas_bps из run_stats на фикстурах; клэмп; формула exec_pp.

### #53. `FUNC-PROBE-OPPORTUNITY-WINDOWS` — детектор окон + дайджест

| Поле | Значение |
|------|----------|
| **Вектор** | FUNC (фиксация возможностей), вторичный TEST |
| **gate / impact / effort / score** | paper-check / 4 / 2 / 16 |
| **Корневые файлы** | `tools/probe-dry-run.mjs` (Stage 3 в `runOnce`), миграция `058` ч.2, новый `tools/arb-digest.mjs` |

#### Решение

**Миграция 058, часть 2:**

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
  samples           INT NOT NULL DEFAULT 1,       -- наблюдений, НЕ циклов (hot/cold ломает семантику)
  run_ids           TEXT[] NOT NULL DEFAULT '{}', -- DISTINCT run_id (D3)
  net_bps_at_50     NUMERIC(10,2),
  net_bps_at_100    NUMERIC(10,2),
  net_bps_at_1000   NUMERIC(10,2),                -- информационно, глубина
  gas_bps_last      NUMERIC(10,2),
  best_net_bps      NUMERIC(10,2) NOT NULL,
  best_notional_usd NUMERIC(20,2) NOT NULL,
  max_notional_positive NUMERIC(20,2) NOT NULL,   -- монотонно; квалификация окна ≥ 50
  venue_pair        TEXT,
  bridge_fee_bps_last NUMERIC(10,4),              -- справочно, НЕ гейт
  tvl_buy_usd_last  NUMERIC(20,4),
  tvl_sell_usd_last NUMERIC(20,4),
  filter_config_id  BIGINT,                       -- FK на 059 после #54; nullable
  status            TEXT NOT NULL DEFAULT 'open',
  expired_at        TIMESTAMPTZ
);
-- дедуп-гейт: partial UNIQUE на открытом окне (паттерн миграции 050);
-- декоративный plain-UNIQUE(... first_seen) из ТЗ v4 убран (ничего не дедуплицировал)
CREATE UNIQUE INDEX IF NOT EXISTS uq_arb_opp_open
  ON dry_run_arb_opportunities (token_addr_buy, token_addr_sell, buy_chain_id, sell_chain_id)
  WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_arb_opp_token ON dry_run_arb_opportunities (token, last_seen DESC);
```

**Stage 3 в `runOnce()`** (после Stage 2) — чистый SQL по run_id, 0 RPC:

1. SELECT наблюдений: `net_pp_bps > 0 AND notional_usd IN (50,100) AND trust != 'suspicious'`.
2. **Предагрегация по маршруту обязательна** (ревью Hermes №4): наблюдения run_id сначала
   сворачиваются в одну строку на (token_addrs, chains) — samples = COUNT, net_bps_at_* —
   последние, иначе мульти-строчный `INSERT … ON CONFLICT … DO UPDATE` падает с
   «cannot affect row a second time». Затем UPSERT одним выражением `INSERT … ON CONFLICT
   (token_addr_buy, token_addr_sell, buy_chain_id,
   sell_chain_id) WHERE status='open' DO UPDATE …` (паттерн 050): last_seen=now(), samples+=
   число наблюдений, `run_ids` distinct-append, перезапись `net_bps_at_*`, best_* max-семантика,
   `max_notional_positive` монотонно. **Семантика $1000 (D3):** окно не открывает и **не продлевает
   last_seen** — только дописывается в существующее; окно может закрыться при живой $1000-глубине —
   осознанное решение.
3. Expire: open с `last_seen < now() − 30 мин` → `status='expired', expired_at=now()`.
   Окно 30 мин = OVER-очереди (гэпы ≤11 мин) ×3; перекалибровка через неделю по фактическому
   распределению длительностей.

**Дайджест** `tools/arb-digest.mjs [--hours 24]` (~60 строк, SELECT-only; запуск руками/по
расписанию оператора — «молчать, когда штатно»): open+expired за окно, группировка по
токенам/маршрутам/venue_pair, топ по `best_net_bps` и глубине, `unverified sell-side` (токены
без dex-obs sell-истории — honeypot-риск), строки-алерты sanity (#52 DoD), `skew-suspect`
(окна с `best_net_bps < 5 bps` — правдоподобно меньше внутрициклового скея ног; в отчёте
spread `block_buy`/`block_sell` их наблюдений).

#### DoD

- [ ] Миграция idempotent.
- [ ] Mechanics-смоук: временно порог −1000 → строки появляются → вернуть 0.
- [ ] Два подряд наблюдения одного маршрута → одна строка, samples=2, `run_ids` без дублей.
- [ ] Мульти-наблюдения одного маршрута в одном цикле ($50+$100 одновременно) предагрегированы —
      UPSERT не падает «cannot affect row a second time» (фикстура).
- [ ] Expiry срабатывает (подмена `now()` / тест-функция).
- [ ] `node --test` чистой функции `matchOpportunity(existing, obs)`.
- [ ] Дайджест на synthetic-данных: группировка + sanity-алерт + skew-suspect.
- [ ] $1000-фикстура не открывает новое окно.

### #54. `FUNC-PROBE-FILTER-LAB` — офлайн grid-search по накопленным данным

| Поле | Значение |
|------|----------|
| **Вектор** | FUNC (прямой ответ на директиву «бот сам ищет фильтры»), вторичный TEST |
| **gate / impact / effort / score** | paper-check / 5 / 2 / 20 |
| **Корневые файлы** | новый `tools/filter-lab.mjs` (~300 строк, 0 RPC), миграция `059` |
| **Разгон** | гонять после ≥48–72 ч данных, накопленных после #52 (до-A истории нет контекста) |

#### Решение

**Миграция 059** — `dry_run_filter_experiments`: `window_from/to`, `filter_config` JSONB,
`config_hash` sha1(canonical json), `split TEXT ('train'|'validate')`, `denominator_rule TEXT`
(фиксирует правило: exec_pp-строки, не-suspicious, нотионалы 50/100), `obs_total`,
`obs_positive` (`net_pp_bps > 0`), `obs_positive_tokens`, `positive_rate`, `median/avg_net_bps`,
`max_notional_positive`, `opportunities_detected` (join окон после #53), `verdict`, `notes`,
`UNIQUE(config_hash, window_from, split)`; idempotent.

**`tools/filter-lab.mjs`:** оси (кастомизируются `--tvl-bands "5e4:1e5,1e5:5e5"`):
`tvl_band` (min двух ног из metadata) [1K,10K)…[5M,20M); `vol24h_band` [0,100)…[100K,∞);
`trust` canonical/heuristic; `pool_age` <24h / 24h–7d / >7d / unknown; `direction` (6);
`venue_pair` (решение п.4). Источник — `net_pp_bps` + контекст #52 → плоский GROUP BY
(LATERAL не нужен). Хронологический сплит 70/30: комбинация × сплит = строка. Вердикты:
`promising` — positive_rate ≥ 0.1% И `obs_positive_tokens ≥ 2` И `max_notional_positive ≥ 50`
**на train И validate**; `single-incident` — позитивы есть, токен 1; `dead` — obs_total ≥ 1000
и 0 позитивов; иначе `no-data`. CLI: `--from --to --report` (топ-20 на консоль).

**Аналитика сырого ряда (расширение решением оператора №6, после миграции 060):** по
каждому межсетевому токену из `dry_run_raw_token_prices` копится временной ряд спредов;
FilterLab добавляет: фичу `spread_percentile` (текущий спред против собственной 7-дневной
истории, p95/z-score — ловит медленные дрейфы и устойчивые премии сетей, а не только
мгновенные гэпы), пометку `newborn_watch` (токены с пулами <72 ч), агрегат направлений
«какая сеть дешёвая → дорогая» (куда дрейфует инвентарь) и **сводку покрытия в шапке
`--report`** (сверка DefiLlama vs registry по venue — дыра видна числом; кейс Sushi=0 был
бы пойман этим гейтом автоматически).

#### DoD

- [ ] Миграция 059 idempotent.
- [ ] После ≥48 ч после-#52 данных прогон <60 c и >100 строк.
- [ ] OVER-инцидент → `single-incident`, не `promising` (тест оверфит-гейта; замена DoD v3
      «бакет обязан дать promising»).
- [ ] `node --test` метрик на фикстурах (positive_rate / max_notional / verdict).
- [ ] `--report` читаем на консоли.
- [ ] Фича `spread_percentile` на фикстурах ряда спредов (медленный дрейф детектится).
- [ ] `--report` включает сводку покрытия (coverage-аудит) и агрегат направлений дрейфа.

### #55. `FUNC-PROBE-SWEEP` — query-time sweep неисследованного

| Поле | Значение |
|------|----------|
| **Вектор** | FUNC (расширение поиска в онлайн), вторичный ARCH (без мутации time-series) |
| **gate / impact / effort / score** | paper-check / 3 / 1 / 15 |
| **Корневые файлы** | `probe-config.json` (блок `sweep`), `probe-dry-run.mjs` (eligibility-CTE Phase 2) |

#### Решение

**Пере-скоуп (решение оператора №6 «полная вселенная»):** TVL-полосы больше не фильтруют
сбор — варианты sweep задают стратегии quote-тира: возрастные окна (newborn ≤24 ч / ≤72 ч),
фокус на venue-паре. Пороги сырьевого триггера НЕ вращаем (конфаунд измерения). Принципы
без изменений: query-time, без UPDATE eligible, бюджет RPC инвариантен, конффаунд
variant≡времени помечается в отчётах. Запуск — после стабилизации quote-тира (#57).

Конфиг: `sweep { enabled:false, variants:[{id, tvlMinUsd, tvlMaxUsd, poolAgeMaxHours?}],
rotateEveryCycles:3 }`. Variant применяется **query-time в eligibility-CTE Phase 2** (последний
snapshot, `tvl_usd BETWEEN bounds`) — **никаких UPDATE eligible** (флаг общий с Phase 1
`getEligibleCrossDexPairs` и является time-series — перезапись портила бы историю и вселенную
Phase 1). `metadata.sweep_variant` в каждую cc-строку; лог `[sweep] cycle N → variant=X`.
RPC-бюджет неизменен. Известный конффаунд (пометка в `--report` FilterLab): ротация каждые
3 цикла = варианты сравниваются на непересекающихся временных окнах (variant≡время).

#### DoD

- [ ] Ротация в логе; ≥2 значений `sweep_variant` за час в cc-obs.
- [ ] RPC/цикл ±20% против обычного режима.
- [ ] Без флага и `enabled:false` поведение идентично текущему (`sweep_variant` NULL).
- [ ] Регресс-гейт: `snapshots.eligible` не изменяется ротацией (сравнение до/после).

### #56. `REL-PROBE-RPC-EFFICIENCY` — MC3-батчинг, hot/cold, RPC-guard

| Поле | Значение |
|------|----------|
| **Вектор** | REL (стабильность циклов и бюджета), вторичный PERF |
| **gate / impact / effort / score** | paper-check / 4 / 2 / 16 |
| **Корневые файлы** | `probe-discovery.mjs` (чтения ликвидности), `probe-dry-run.mjs` (rate limiter, кадence) |
| **Зависимость** | #52 (`run_stats.rpc_calls` — источник P95 для guard) |

#### Решение

1. **Multicall3-батчинг Stage 0** через `aggregate` (**НЕ aggregate3** — реверты на BlockPi,
   §1.3), батчи ~50 пулов; только view-чтения (reserves/slot0/liquidity), квоты НЕ батчим
   (QuoterV2 non-view).
2. **Снять `LIMIT 500`** → весь registry (Base 1061 ≈ ~25 MC3-вызовов на refresh).
3. **Приоритизация quote-листа** (ре-скоуп ревью Hermes №5): после #57 вселенная
   trigger-driven, отдельный hot/cold-расписание — источник рассинхрона; hot/cold теперь
   = **порядок квотирования внутри цикла** (открытые окна + триггернутые токены — первыми,
   холодный хвост — в конце под guard), а не расписание.
4. **RPC-guard:** `rpc_calls` цикла > P95×1.5 (P95 за 24 ч по run_stats) → пропуск cold-тира,
   `cold_tier_skipped=TRUE`. Потолок тарифа BlockPi проверить в дашборде до подъёма
   `PROBE_RATE_LIMIT_RPS` (25 rps самоналожены).

#### DoD

- [ ] Stage-0 циклы ≤1.5× нормального (было ~2.8×).
- [ ] Снапшоты покрывают весь registry (Base ~1061).
- [ ] `rpc_calls`/цикл стабилен после включения hot/cold.
- [ ] Hot-токены наблюдаются в соседних циклах.

### #57. `FUNC-PROBE-COVERAGE` — полная вселенная + сырьевой тир (воронка raw→триггер→exec)

| Поле | Значение |
|------|----------|
| **Вектор** | FUNC (полная вселенная для автопоиска — решение оператора №6), вторичный REL |
| **gate / impact / effort / score** | paper-check / 5 / 3 / 15 |
| **Корневые файлы** | `tools/seed-registry-defillama.mjs`, `probe-discovery.mjs` (`FACTORIES`, probing, MC3-чтения), `probe-dry-run.mjs` (вселенная Phase 2 → trigger-driven), миграция `060` |
| **Зависимости** | #52 (`net_pp_bps`, run_stats), #56 (MC3-паттерн батчинга) |

#### Решение

1. **Полная вселенная без полосы ликвидности.** DefiLlama ре-сит с `SEED_TVL_MIN=0` (пол
   убран — сейчас дамп начинается с ~$10K, тонкие пулы не попадают в registry вообще) +
   newborn-события всех подключённых фабрик. Полоса сбора удаляется из конфига; ликвидность
   остаётся только осью анализа FilterLab (offline).
2. **Сырьевой тир.** Каждые `raw.intervalCycles` (дефолт 3) — Multicall3 `aggregate`-батчи
   читают резервы/slot0 **всех живых пулов** (живой = ненулевые резервы или свежие свопы;
   мёртвые отсеиваются тем же сырьём и перестают читаться). Стоимость: десятки пулов на
   вызов (размер батча тюнится — V3 `slot0` объёмный, закладываем 20–50 на вызов против
   лимита ответа, ревью Hermes №6) → тысячи пулов ≈ десятки вызовов на сеть на прогон.
   Результат — таблица миграции 060:

   ```sql
   CREATE TABLE IF NOT EXISTS dry_run_raw_token_prices (
     id                BIGSERIAL PRIMARY KEY,
     observed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     run_id            TEXT NOT NULL,
     chain_id          INT NOT NULL,
     token_addr        TEXT NOT NULL,
     price_marginal_usd NUMERIC(20,8) NOT NULL,
     best_venue        TEXT NOT NULL,
     pool_addr         TEXT NOT NULL,
     tvl_usd           NUMERIC(20,4),
     spread_cross_bps  NUMERIC(10,4),   -- заполняется для токенов в ≥2 сетях
     trust             TEXT,
     metadata          JSONB DEFAULT '{}'
   );
   CREATE INDEX IF NOT EXISTS idx_raw_tok_time ON dry_run_raw_token_prices (token_addr, observed_at DESC);
   CREATE INDEX IF NOT EXISTS idx_raw_tok_observed ON dry_run_raw_token_prices (observed_at);
   ```

   **Retention-тиринг** (ревью Hermes №7): полное разрешение — 48 ч; старше — часовые
   агрегаты (median/p95 спреда на токен); сырьё старше — удаление. Без тиринга raw-таблица
   растёт до 15–30M строк/мес и убивает FilterLab-запросы по ряду. Чистка — в цикле probe.
3. **Триггер из сырья (0 RPC).** Из сырьевых цен считается межсетевой спред каждого токена
   (≥2 сетей, гейт валидности: ненулевые резервы обеих ног, совпадающие decimals, цена в
   разумном диапазоне; canonical-мажоры не триггерятся — их спред = комиссионный шум).
   Спред **fee-adjusted** (ревью Hermes №8): из маргинального спреда вычитаются известные
   fee пулов обеих ног (registry `fee_millionths`; V2 — константа dex; algebra — последнее
   известное из `globalState`) — фантомный «спред» тира 1% vs 0.05% (~95 bps) не триггерит
   и не жжёт квот-бюджет. Fee-adjusted спред > `raw.triggerBps` (стартовый 25, для
   `newborn_watch` <72 ч — вдвое ниже; калибровка по данным после ≥48 ч сырья —
   решение №6) → токен попадает в quote-лист следующего
   цикла. **Phase 2 переключается с полосы eligible на trigger-driven вселенную:**
   квотируются на нотионале только триггернутые токены, открытые окна и newborn-watch;
   порядок квотирования внутри цикла — приоритизация quote-листа (hot из #56 = открытые
   окна + триггернутые; ревью Hermes №5).
4. **Sushi-фикс:** registry 0 пулов при живых фабриках Arb/Base — залить factory-getLogs
   backfill'ом (BlockPi до 400K блоков, пагинация ≤5K — верифицировано) и/или DefiLlama;
   **OP: добавить sushi-фабрику в `FACTORIES` + on-chain верификация адреса** (конвенция
   дома — неверные адреса уже дважды давали EOA-тихую дыру).
5. **Newborn-пробинг** solidly/slipstream: Aerodrome `getPool(a,b,stable)`, Slipstream
   `getPool(a,b,int24)`.
6. **Coverage-аудит (гейт «ничего не ускользнуло»):** `tools/probe-coverage-audit.mjs` —
   сверка DefiLlama pools per venue vs registry; расхождение печатается числом по каждой
   бирже (кейс Sushi=0 был бы пойман автоматически). Запуск руками/расписанием; итоги — в
   шапке FilterLab `--report`.

#### DoD

- [ ] Coverage-аудит: registry покрывает ≥95% пулов каждой подключённой биржи по DefiLlama
      (или расхождение объяснено в отчёте).
- [ ] Ре-сит с `SEED_TVL_MIN=0` залит; в cc-obs появляются токены с TVL < $1K (контекст
      `tvl_band` в metadata).
- [ ] Сырьевой тир: `dry_run_raw_token_prices` пишется для живых пулов; MC3-вызовы/прогон
      видны в run_stats; retention чистит старше N дней.
- [ ] Триггер: сырой спред > порога → токен квотируется в следующем цикле (проверяемо по
      логам/metadata); Phase 2 не зависит от eligible-полосы.
- [ ] Fee-adjusted триггер: фикстура «пул 1% vs 0.05%» не триггерит (нет фантомного спреда).
- [ ] После ≥48 ч сырья: распределение триггер-рейта на 10/15/25 bps → порог выбран по
      данным, выбор зафиксирован в notes конфига.
- [ ] Retention-тиринг работает: сырьё старше 48 ч сворачивается в часовые агрегаты.
- [ ] Гейт валидности сырья отсекает фантомные цены скам-токенов (фикстура).
- [ ] Sushi >0 пулов в registry (или root-cause отчёт, почему 0).
- [ ] OP sushi-фабрика добавлена с верифицированным адресом (возвращает код контракта).
- [ ] Newborn solidly/slipstream пулы обнаруживаются событиями/пробингом (логи + registry).

### #58. `FUNC-PROBE-EVENT-TRIGGERS` — событийные триггеры (Swap → немедленная квота)

| Поле | Значение |
|------|----------|
| **Вектор** | FUNC (скорость реакции — снятие 5.5-мин алиасинга), вторичный PERF |
| **gate / impact / effort / score** | paper-check / 4 / 2 / 16 |
| **Корневые файлы** | `probe-dry-run.mjs` (event-poll шаг), `probe-discovery.mjs` (getLogs-утилиты) |
| **Зависимости** | #57 (сырьевые цены для USD-оценки амплитуд свопов), #52 |

#### Решение

Каждое окно блоков (отдельный таймер ~30–60 c, не ждёт цикла) — `eth_getLogs` Swap-событий
по адрес-листам живых пулов подключённых бирж, чанками по 100–200 адресов (смоук 2026-08-18
закрыл вопрос объёма: 100 адресов + topic0-OR = 0.1–0.35 c и 0.2–0.4 MB на 5-мин окно на
самой загруженной сети — §1.3; NB ethers-ловушка: OR-форма `[[A,B]]`, а `[A,B]` = AND).
Крупный своп в USD (амплитуды события × сырая цена из #57) по токену, присутствующему в
≥2 сетях → **немедленная exec-квота этого токена вне цикла**, пометка
`metadata.trigger='event'`; run_id синтетический `event-<uuid>`, в run_stats —
`source='event'` (ревью Hermes №3 — схема совместима, cc-obs NOT NULL сохраняется).
Дислокация рождается в момент крупного свопа в тонком пуле — так ловим её в момент
возникновения, а не по расписанию. Бюджет: кап `event.maxQuotesPerHour` (дефолт 60),
приоритет — открытые окна и newborn; учёт в run_stats; RPC-guard #56 распространяется на
event-квоты. V2-тир в смоуке был тих (0 логов/5 мин на Base/OP V2-подмножестве) — при
реализации убедиться, что V2-топик ловится живьём.

#### DoD

- [ ] Событийный триггер на тестовом свопе (фикстура лога) → квота вне цикла,
      `metadata.trigger='event'`.
- [ ] Кап event-квот/час соблюдается (учёт в run_stats).
- [ ] Суммарный RPC в бюджете: guard #56 не срабатывает чаще фонового уровня.
- [ ] Латентность «событие → квота» ≤ 60 c на живом стенде (замер по логам).

---

## 6. Порядок работ и зависимости

```
#52 exec_pp ──→ #53 окна ──→ #56 MC3/hot-cold ──→ #57 raw-тир ──→ #58 event-триггеры
                                        │                │
                                        └────────────────┴──→ #54 FilterLab (полный: после 060 + 48–72 ч данных)
#55 sweep — после стабилизации quote-тира (#57)
```

**Оценка** (уточнена по ревью Hermes №10): #52 — 0.5–1 д; #53 — 1 д; #56 — 1–1.5 д; #57 —
2–3 д (сидирование без пола + сырьевой тир + валидность + fee-триггер + переключение
Phase 2 + Sushi-бэкфилл + OP-фабрика + newborn + coverage-аудит); #58 — 1–1.5 д; #54 —
1–1.5 д (ядро пишется параллельно с #53, полный прогон — после #57); #55 — 0.5 д. Итого
~7–9 дней по цепочке. Миграции: **058** (#52+#53), **059** (#54), **060** (#57 — сырьевые
цены токенов).

## 7. Риски и митигации

| Риск | Митигация |
|---|---|
| Разгон данных: сплит #54 не раньше 48–72 ч после #52 | `no-data`/`single-incident` первые дни — норма, не провал |
| Редкость: 24 позитива/48 ч на 1 токене; `promising` может быть 0–2 | Ответ рынка, не баг; sweep (#55) + полоса $5–20M (#57) расширяют; отсутствие конфигов = валидная фальсификация |
| Honeypot: exec-квота ≠ реальная продаваемость | trust-гейты + `unverified sell-side` в дайджесте |
| Внутрицикловой скея ног создаёт фантомный edge | `block_buy/block_sell` в metadata + `skew-suspect` (<5 bps) в дайджесте; окна не блокируются |
| Окно 30 мин — гипотеза из OVER-очередей | перекалибровка через неделю по распределению длительностей |
| Суб-минутные окна — слепая зона | честно фиксируется в отчётах; hot-кадence (#56) сжимает до ~5.5 мин на живых |
| Газ-спайки ложно закрывают окна | медиана-3 (#52); мгновенный сэмпл в run_stats для диагностики |
| Мусорные котировки роняют INSERT-батч | клэмп ±99999 + `net_pp_raw` (#52) |
| Arb factory-getLogs молчит (0 событий без ошибки) | отдельная диагностика, не блокер фаз |
| `aggregate3` на BlockPi реверты | только `aggregate` (#56), задокументировано §1.3 |
| Объём raw-тира (без тиринга — 15–30M строк/мес) | retention-тиринг: 48 ч полное → часовые агрегаты (median/p95) → удаление (#57; ревью №7) |
| **Полнота итерации 1 ограничена `triggerBps` снизу** (валидные окна с exec net_pp > 0 при сырье < порога не видны) | порог калибруется по данным после 48 ч (решение №6); граница метода зафиксирована, не скрывается (ревью №1) |
| Фантомные raw-спреды от разницы fee-тиров (1% vs 0.05% ≈ 95 bps) | fee-adjusted триггер (#57) + метрика триггер-рейта в run_stats (ревью №8) |
| MC3-батч сырья упирается в лимит ответа (V3 slot0 объёмный) | размер батча 20–50 тюнится на живом стенде; «десятки вызовов на сеть» не меняется (ревью №6) |
| Полная вселенная = сотни скам-токенов с фантомными сырыми ценами | гейт валидности сырья (#57): ненулевые резервы обеих ног, decimals совпадают, цена в разумном диапазоне; trust-гейты; canonical не триггерится |
| Низкий `triggerBps` выжигает квот-бюджет на мусоре | порог 25 bps по умолчанию; кап event-квот/час (#58); RPC-guard P95×1.5 (#56) |
| Полный дамп DefiLlama — тысячи пулов на сеть | разовое сидирование ротационно; alive-фильтр сырьём (нулевые резервы → пул не читается далее) |

## 8. Что план НЕ покрывает

- Исполнение сделок, мосты/маршруты, кошельки/ключи, ребаланс инвентаря — вне скоупа
  (явное решение оператора: pre-positioned, «как переместить актив» — позже и отдельно).
- EO / opportunity-service / risk / capital / live-стек — не трогаем; kill-switch состояние
  не меняется; probe остаётся read-only standalone.
- Hermes-дайджест в Telegram, страница probe в `/dashboard`, WS-подписки на блоки, модель
  дрейфа инвентаря — отложено (потенциальные инициативы следующей итерации, по данным #54).
- Хвост opp-service: Paper*-outbox ~40/ч в dead-letter после остановки paper — отдельная
  ops-задача, вне этого плана.
- До-#52 история cc-obs не ретро-анализируется FilterLab (нет контекста при записи) — честно
  зафиксировано; знаменатели экспериментов считаются только по после-#52 строкам.

## 9. Жизненный цикл

`proposed` (2026-08-17, директива оператора) → `accepted` (2026-08-18, финальный мерж
proposal ZCode + ТЗ Hermes v4 + ревью D1–D4; инициативы #52–#57 в реестре roadmap-vectors).
Расширение `accepted` (2026-08-18, решением оператора №6 «полная вселенная»): #57 расширен
сырьевым тиром (полоса сбора упразднена, вселенная Phase 2 → trigger-driven), добавлено #58
(событийные триггеры), #54 усилен аналитикой сырого ряда и coverage-аудитом. **Ревью
Hermes от 2026-08-18 принято** (10 пунктов: 3 смысловых — граница полноты triggerBps,
Swap-getLogs смоук (закрыт живым замером, §1.3), совместимость run_stats с event-квотами;
7 технических — предагрегация UPSERT, ре-скоуп hot/cold, батч-сайз MC3, retention-тиринг,
fee-adjusted триггер, approximate-блоки ног, оценки 7–9 д). Следующая фаза: `in-progress`
с #52.

---

*Составлено: 2026-08-18. Мерж: proposal ZCode (замеры/верификации 2026-08-17) + ТЗ Hermes v3
(2026-08-17) + ТЗ Hermes v4 (2026-08-18, решения оператора) + ревью ZCode (D1–D4, развод сеток,
блоки ног) + расширение оператора «полная вселенная» (2026-08-18: сырьевой тир #57, event-триггеры
#58, аналитика сырого ряда в #54). Все `file:line`, SQL-замеры и on-chain факты верифицированы на
дату составления (код — чтением; БД — SQL на живом стенде Aéza; chain — smoke через BlockPi и
публичные RPC). При изменении кода — обновить этот файл по принципу P2.*
