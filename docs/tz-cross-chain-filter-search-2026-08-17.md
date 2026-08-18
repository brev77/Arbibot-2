# ТЗ: Поиск и фиксация межсетевых арбитражных возможностей (v3)

**Дата:** 17 августа 2026, 20:10 МСК
**Автор:** Hermes Agent (Arbibot2_hermes) · **Исполнитель:** ZCode (Cursor)
**Цель:** бот систематически ищет настройки фильтров, при которых находятся межсетевые арбитражные возможности, и фиксирует каждую возможность отдельной записью.

**Вне скоупа (не делать):** исполнение сделок, пути обмена, мосты, EO/opportunity-service/risk, live-торговля, управление капиталом. Обоснование: в трёх сетях будут свои кошельки — вопрос «как переместить актив» решается позже и отдельно.

---

## 0. Опорные факты (из кода и БД, 2026-08-17)

| Факт | Значение | Источник |
|---|---|---|
| Probe стабилен | 465+ циклов, 4 мин/цикл, 3 сети | pm2 `probe-dry-run`, лог циклов |
| Накоплено cc-obs | 124K+ строк за 48ч | `dry_run_cross_chain_observations` |
| Честный exec round-trip | уже реализован (USDC→токен→fee Across→токен→USDC) | `tools/probe-dry-run.mjs:610-640` |
| Positive edges: мажоры (canonical) | **0** из 29,696 за 48ч, лучший -4.1 bps | SQL по metadata->'exec' |
| Positive edges: тонкие (heuristic) | 24 из 42,540 за 48ч, все — токен OVER (OP→Base), +108 bps max на $10 | там же |
| Положительные на $1000+ | **0 за 7 дней** | там же |
| Persistence | positives идут очередями 2-3 цикла подряд (03:36→03:40→03:44 UTC) | SQL по OVER |
| Base dex-obs | пишутся: 103K/24ч — FIX-PROBE-8 закрыт | `dry_run_dex_observations` |
| Фильтры статичны | `tools/probe-config.json` filter{}, меняются руками | файл, строки 36-41 |
| Universe на цикле | eligibility = latest snapshot eligible=TRUE | `probe-dry-run.mjs:522-545` |
| Снимки ликвидности | 122K строк с tvl_usd/volume_24h_usd, время есть | `dry_run_liquidity_snapshots` |
| Миграции | последняя 057, стиль: idempotent CREATE IF NOT EXISTS | `infra/postgres/migrations/` |

---

## Часть A — FilterLab: офлайн grid-search по накопленным данным

### A1. Миграция `058_dry_run_filter_experiments.sql`
Стиль дома: комментарий-шапка, idempotent. DDL:

```sql
CREATE TABLE IF NOT EXISTS dry_run_filter_experiments (
  id                BIGSERIAL PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  window_from       TIMESTAMPTZ NOT NULL,          -- окно анализа
  window_to         TIMESTAMPTZ NOT NULL,
  filter_config     JSONB NOT NULL,                -- конфигурация осей (см. A2)
  config_hash       TEXT NOT NULL,                 -- sha1(canonical json), для дедупа
  obs_total         INT NOT NULL,                  -- наблюдений под конфигом
  obs_positive      INT NOT NULL,                  -- exec net_bps > 0
  positive_rate     NUMERIC(8,6) NOT NULL,         -- obs_positive/obs_total
  median_net_bps    NUMERIC(10,2),
  avg_net_bps       NUMERIC(10,2),
  max_notional_positive NUMERIC(20,2),             -- наибольший notional_usd с net_bps>0 (глубина)
  tokens_with_positive INT NOT NULL,               -- DISTINCT token с net_bps>0
  opportunities_detected INT NOT NULL,             -- строк в dry_run_arb_opportunities (после части C)
  verdict           TEXT NOT NULL DEFAULT 'pending', -- 'promising' | 'dead' | 'no-data' | 'pending'
  notes             TEXT,
  UNIQUE (config_hash, window_from)
);
CREATE INDEX IF NOT EXISTS idx_filter_exp_verdict
  ON dry_run_filter_experiments (verdict, positive_rate DESC);
```

### A2. Оси grid-search (`tools/filter-lab.mjs`, новый файл ~300 строк)
Только чтение БД, 0 RPC-запросов. Один прогон = FULL OUTER по осям, каждая комбинация = строка в `dry_run_filter_experiments`.

| Ось | Бакеты |
|---|---|
| tvl_band_usd | [1K,10K), [10K,50K), [50K,100K), [100K,500K), [500K,1M), [1M,5M) |
| vol24h_band_usd | [0,100), [100,1K), [1K,10K), [10K,100K), [100K,∞) |
| trust | canonical / heuristic / both |
| pool_age | <24h / 24h-7d / >7d (из `dry_run_pool_registry.created_at_block` vs discovered_at; NULL возраст = бакет unknown) |
| buy_chain, sell_chain | 6 направлений |

**Ключевой JOIN (ликвидность на момент наблюдения, не текущая):**
cc-obs не хранит TVL. Присоединять через адрес токена к пулам, где он торгуется:
```sql
FROM dry_run_cross_chain_observations o
JOIN LATERAL (
  SELECT max(s.tvl_usd) AS token_tvl_buy
  FROM dry_run_liquidity_snapshots s
  JOIN dry_run_pool_registry p ON p.chain_id=s.chain_id AND p.pool_addr=s.pool_addr
  WHERE p.chain_id = o.buy_chain_id
    AND o.token_addr_buy_chain IN (p.token0_addr, p.token1_addr)
    AND s.observed_at <= o.observed_at
  ORDER BY ... LIMIT 1  -- последняя snapshot ≤ момента наблюдения
) lb ON TRUE
-- аналогично ls для sell-цепи; tvl_token = least(lb, ls) — узкое место маршрута
```
(точную форму LATERAL — на исполнителе; суть: TVL токена на момент наблюдения, не «сейчас»).

**Метрики** считаются по `metadata->'exec'->>'net_bps'`, notional_usd, trust:
- `positive_rate`, `median/avg net_bps` — по exec-наблюдениям конфиги
- `max_notional_positive` — max(notional_usd) среди net_bps>0
- `verdict`: `promising` если positive_rate ≥ 0.1% И tokens_with_positive ≥ 1 И max_notional_positive ≥ 100; `dead` если obs_total ≥ 1000 И obs_positive = 0; иначе `no-data`

### A3. CLI и вывод
```
node tools/filter-lab.mjs --from "2026-08-14" --to "2026-08-18"   # прогон
node tools/filter-lab.mjs --report                                # топ-20 promising на консоль
```
`--report` выводит таблицу: конфиг | positive_rate | max_notional | tokens | verdict. Никаких RPC, никаких правок данных.

### A4. DoD части A
1. Миграция 058 накатывается `npm run db:migrate`, повторный запуск не падает (idempotent).
2. `node tools/filter-lab.mjs --from ... --to ...` на реальных 124K строк завершается < 60 сек и пишет > 100 строк в `dry_run_filter_experiments`.
3. Проверка: `SELECT count(*), count(*) FILTER (WHERE verdict='promising') FROM dry_run_filter_experiments;` — обе > 0 (бакет [1K,10K)+heuristic обязан дать promising по факту OVER).
4. Unit-тест на расчет метрик (fixtures: массив exec-наблюдений → ожидаемые positive_rate/max_notional). Расположение: `tools/filter-lab.test.mjs` (node:test), запуск `node --test tools/`.

---

## Часть B — Фиксация возможностей: `dry_run_arb_opportunities`

### B1. Миграция `059_dry_run_arb_opportunities.sql`
```sql
CREATE TABLE IF NOT EXISTS dry_run_arb_opportunities (
  id                BIGSERIAL PRIMARY KEY,
  token             TEXT NOT NULL,
  token_addr_buy    TEXT NOT NULL,
  token_addr_sell   TEXT NOT NULL,
  buy_chain_id      INT NOT NULL,
  sell_chain_id     INT NOT NULL,
  trust             TEXT NOT NULL,                 -- canonical | heuristic
  first_seen        TIMESTAMPTZ NOT NULL,
  last_seen         TIMESTAMPTZ NOT NULL,
  cycles_alive      INT NOT NULL DEFAULT 1,        -- DISTINCT run_id с edge>0
  run_ids           TEXT[] NOT NULL DEFAULT '{}',
  net_bps_at_10     NUMERIC(10,2),
  net_bps_at_100    NUMERIC(10,2),
  net_bps_at_1000   NUMERIC(10,2),
  best_net_bps      NUMERIC(10,2) NOT NULL,
  best_notional_usd NUMERIC(20,2) NOT NULL,        -- notional лучшего наблюдения
  max_notional_positive NUMERIC(20,2),             -- глубина за время жизни
  bridge_fee_bps_last NUMERIC(10,4),               -- информационно, НЕ гейт
  tvl_buy_usd_last  NUMERIC(20,4),                 -- на момент последнего среза
  tvl_sell_usd_last NUMERIC(20,4),
  filter_config_id  BIGINT REFERENCES dry_run_filter_experiments(id), -- чем поймана (после A)
  status            TEXT NOT NULL DEFAULT 'open',  -- open | expired
  expired_at        TIMESTAMPTZ,                   -- last_seen + 30 мин без обновления
  UNIQUE (token_addr_buy, token_addr_sell, buy_chain_id, sell_chain_id, first_seen)
);
CREATE INDEX IF NOT EXISTS idx_arb_opp_open
  ON dry_run_arb_opportunities (status, best_net_bps DESC);
CREATE INDEX IF NOT EXISTS idx_arb_opp_token
  ON dry_run_arb_opportunities (token, last_seen DESC);
```

### B2. Детект в probe (post-processing шаг цикла, `probe-dry-run.mjs`)
Новый шаг Stage 3 в `runOnce()` (после Stage 2, `probe-dry-run.mjs:741-765`): чистый SQL по только что записанным run_id, **0 дополнительных RPC**.

Логика:
1. SELECT наблюдений текущего run_id с `metadata->'exec'->>'net_bps' > 30` (порог `config.opportunityMinNetBps`, дефолт 30) AND `metadata->>'trust' != 'suspicious'`.
2. Для каждого — UPSERT: существующая open-строка с тем же (token_addr_buy, token_addr_sell, chains) и last_seen в пределах 30 мин → обновить last_seen, cycles_alive+1, run_ids append, перезаписать net_bps_at_* / best_* / tvl_*; иначе INSERT новой.
3. UPDATE `status='expired', expired_at=now()` для open-строк с last_seen < now() - 30 мин (окно = 7 циклов × 4 мин; очереди реальных positives живут 2-3 цикла — окно с запасом ×3).
4. `max_notional_positive` — max за всё время жизни (не затирается).

Важно: bridge fee уже внутри exec net_bps (honest math) — двойного учёта нет; в `bridge_fee_bps_last` пишем для справки.

### B3. Дайджест
`node tools/arb-digest.mjs [--hours 24]` (новый, ~60 строк): open+expired за окно, группировка по токенам/маршрутам, топ по best_net_bps и глубине, какие filter_config их поймали. Только SELECT. Запуск руками/по расписанию оператором — бот ничего не шлёт сам (принцип «молчать, когда штатно»).

### B4. DoD части B
1. Миграция 059 idempotent.
2. Прогон probe 2+ циклов: `SELECT count(*) FROM dry_run_arb_opportunities;` — таблица заполняется (при текущем рынке большинство дней пусто — валидно; проверка mechanics: временно выставить `opportunityMinNetBps: -1000` в config → строки появляются → вернуть 30).
3. UPSERT-механика: при двух подряд циклах с edge у одного маршрута — cycles_alive=2, одна строка, а не две.
4. Expiry: open-строка старше 30 мин получает status=expired.
5. Unit-тест окна/UPSERT-решения (функция `matchOpportunity(existing, obs) → boolean`): чистая логика без БД, `tools/arb-opportunities.test.mjs`.

---

## Часть C — Sweep-режим probe: онлайн-исследование неисследованного

### C1. Конфиг (`probe-config.json`)
```json
"sweep": {
  "enabled": false,
  "variants": [
    { "id": "thin-newborn", "tvlMinUsd": 1000,  "tvlMaxUsd": 50000,  "poolAgeMaxHours": 24 },
    { "id": "mid",          "tvlMinUsd": 50000, "tvlMaxUsd": 500000 },
    { "id": "current",      "tvlMinUsd": 1000,  "tvlMaxUsd": 5000000 }
  ],
  "rotateEveryCycles": 3
}
```

### C2. Механика (`probe-dry-run.mjs`)
1. Флаг `--sweep` ИЛИ `sweep.enabled=true`: каждые `rotateEveryCycles` циклов активный variant меняется по кругу.
2. Variant влияет ТОЛЬКО на eligibility-порог Universe (Stage 2, строки ~522-545): пересчитывать eligible из **уже сохранённых** tvl_usd в snapshots (`UPDATE ... SET eligible = tvl_usd BETWEEN ...`), не добавляя RPC-запросов.
3. В каждую строку cc-obs дописывать `metadata.sweep_variant` = id активного variant (в INSERT, строка ~648).
4. Rate limit / период / notional-сетка НЕ меняются — бюджет BlockPi неизменен.
5. Лог: `[sweep] cycle N → variant=thin-newborn`.

### C3. Замыкание с FilterLab
`filter-lab.mjs --report` группирует в том числе по `metadata.sweep_variant` → видно, какой variant ловит возможности. `dry_run_arb_opportunities.filter_config_id` ссылается на лучший эксперимент (заполнять можно вручную SQL-скриптом из отчёта; автоматика линковки — опционально, не блокирует).

### C4. DoD части C
1. Запуск с `--sweep`: в логе ротация; в БД `SELECT metadata->>'sweep_variant', count(*) FROM dry_run_cross_chain_observations WHERE observed_at > now()-interval '1 hour' GROUP BY 1;` — ≥ 2 значений.
2. Расход RPC не вырос: число quote-вызовов за цикл в логах сопоставимо с обычным режимом (±20%).
3. Без флага и с `enabled:false` поведение идентично текущему (регресс нет): cc-obs пишутся, `sweep_variant` = NULL.

---

## Порядок работ и оценка
1. **A** (миграция 058 + filter-lab.mjs + тест) — 3-4 дня. Можно стартовать немедленно: все данные уже в БД.
2. **B** (миграция 059 + Stage 3 в probe + arb-digest.mjs + тест) — 2-3 дня. Независимо от A (filter_config_id nullable).
3. **C** (sweep поверх результатов A) — 1-2 дня.
A и B параллелить допустимо (разные файлы/таблицы; конфликт только в probe-dry-run.mjs при B Stage 3 и C ротации — мержить аккуратно).

## Критерии приёмки всего ТЗ
- Grid-search отвечает на вопрос «какие настройки фильтров находят возможности» строками verdict='promising' с числами, а не словами.
- Каждая возможность — одна строка в `dry_run_arb_opportunities` с жизненным циклом (open→expired), глубиной и persistence.
- Расход платного RPC не увеличен (sweep меняет фильтры, не частоту).
- Всё idempotent, с unit-тестами логики, без правок EO/opp/risk/capital.

## Риски (прямо)
1. **TVL на момент наблюдения** через LATERAL-join по 122K snapshots — тяжёлый запрос; если > 60 сек, материализовать агрегат `token_tvl_5m` (токен, цепь, время, tvl) отдельным шагом перед grid-search.
2. **Редкость событий:** 24 positive-наблюдения/48ч на одном токене — promising-бакетов может быть 1-2. Это не провал ТЗ, это ответ markets; sweep (часть C) расширяет поиск.
3. **Honeypot:** exec round-trip не гарантирует реальную продаваемость; поле trust уже отделяет подозрительных; в дайджесте помечать токены без единой dex-obs sell-истории как `unverified sell-side` (SQL-join dex_observations).
4. **Окно 30 мин** — гипотеза из данных OVER (2-3 цикла); после недели набора — перекалибровать по фактическому распределению.

## Согласование
- Порог opportunityMinNetBps=30 и окно 30 мин — стартовые значения, владелец может менять в config без кода.
- Бакеты TVL/vol в A2 — стартовые; FilterLab должен принимать кастомные бакеты флагом (`--tvl-bands "1e3:1e4,1e4:5e4"`), чтобы перегонять без правок кода.
