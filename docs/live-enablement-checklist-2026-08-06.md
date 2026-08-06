# Чек-лист безопасного включения live-тестов на paper-стенде

**Дата:** 2026-08-06
**Сервер:** Aéza Frankfurt (`arbibot-paper`, 79.137.202.225)
**Контекст:** После устранения каскада bugs (staticNetwork → pinFallbackNetwork → Chainlink decimals bigint), cost gate **пропускает** планы. Pipeline дошёл до `DEX_VENUE_ENABLED` gate — последнего рубежа перед реальными on-chain транзакциями. Этот чек-лист — пошаговая инструкция для безопасного перехода от paper (симуляция) к live (реальные tx на Arbitrum mainnet).

---

## ⚠️ Что означает «включить live»

При `DEX_VENUE_ENABLED=true` бот начнёт **отправлять реальные on-chain транзакции на Arbitrum mainnet** с реальными деньгами с кошелька `0xDea3E1E8cF92349cab0b46095aE03732afB646f3`. Текущий баланс: ~$11 ETH + $44 USDC = **~$55 под риском**.

Это **необратимые** операции. Если алгоритм ошибётся (например, отправит сделку с большой проскальзыванием), деньги можно потерять. Чек-лист ниже минимизирует этот риск через многослойные ограничения.

---

## Текущее состояние стенда (проверено 2026-08-06)

| Компонент | Состояние | Оценка |
|-----------|-----------|--------|
| Cost gate | ✅ пропускает (после decimals fix `dae1620`) | Готов |
| RPC (BlockPi + backup) | ✅ работает, chainId стабилен | Готов |
| `pinFallbackNetwork` | ✅ NETWORK_ERROR = 0 | Готов |
| Кошелёк `prod-arb-1` | ✅ в БД (0xDea3...), импортирован 2026-08-04 | Готов |
| `DEX_LIVE_KILL_SWITCH` | ✅ `false` (нормально для live) | Готов |
| `DEX_VENUE_ENABLED` | ❌ не задано (= выключено) | **Блокер 1** |
| `CAPITAL_MAX_ACTIVE_USD` | ❌ `0` (потолок = ноль) | **Блокер 2** |
| `capital.limits` (БД) | ✅ `maxActiveCapitalUsd=100` | ОК, но env override = 0 |
| `dex.limits` (БД) | ✅ `killSwitch=false, minNetProfitUsd=0.02, maxNotionalPerTrade=15, maxOpenPositions=1` | Разумно |
| `PAPER_AUTO_DRIVE_ENABLED` | ✅ `false` (paper авто-драйвер выключен) | ОК |
| `LIVE_AUTO_DRIVE_ENABLED` | ✅ `true` (live авто-драйвер активен) | Готов |

**Два блокера** нужно устранить перед включением. Остальное — на месте.

---

## Чек-лист (по шагам, с командами)

Каждый шаг — независимый рубеж защиты. **Не пропускайте шаги**, даже если кажется, что они избыточны. Смысл многослойной защиты: если один слой сломается, следующий поймает.

### 🔒 Шаг 0 — Бэкапы и откат (ПЕРЕД любыми изменениями)

**Цель:** иметь возможность откатиться, если что-то пойдёт не так.

- [ ] **Снимок `.env`**: `cp /root/Arbibot-2/.env /root/Arbibot-2/.env.bak.pre-live-$(date +%Y%m%d)`
- [ ] **Бэкап БД**: `cd /root/Arbibot-2 && npm run db:backup` (создаст `backups/arbibot_*.sql.gz`)
- [ ] **Зафиксировать текущий git HEAD**: `cd /root/Arbibot-2 && git log --oneline -1 > /tmp/pre-live-head.txt` (для отката: `git checkout <hash>`)
- [ ] **Проверить panic:stop работает**: `cd /root/Arbibot-2 && npm run panic:stop` → подтвердить `arb_dex_live_halt_active=1` в `/metrics` → `npm run panic:recover` (вернуть в норму)

> Если panic:stop не сработал — **не включать live**, пока не почините.

---

### 💰 Шаг 1 — Установить потолок капитала (Блокер 2)

**Цель:** бот не сможет зарезервировать больше денег, чем вы готовы потерять.

`CAPITAL_MAX_ACTIVE_USD=0` сейчас означает: **ноль капитала разрешено**. Любая `reserveCapital` вернёт ошибку → pipeline встанет. Это нужно поднять до минимальной тестовой суммы.

- [ ] **Установить потолок $10** (DoD Gate 3 требует ≤$10 для rehearsal):
  ```bash
  ssh arbibot-paper
  nano /root/Arbibot-2/.env
  # Найти: CAPITAL_MAX_ACTIVE_USD=0
  # Заменить на: CAPITAL_MAX_ACTIVE_USD=10
  ```
- [ ] **Проверить `dex.limits.maxNotionalPerTradeUsd=15`** в БД (уже установлен, ОК — это per-trade cap).
- [ ] **Проверить `dex.limits.maxOpenPositions=1`** в БД (уже установлен — только 1 одновременная позиция).
- [ ] **Проверить `dex.limits.maxDailyNotionalUsd=50`** в БД (дневной cap на весь объём).

> Эти лимиты в БД (`policy_configurations`) — это **operational guardrails**. Они ограничивают ущерб даже при баге в алгоритме: бот не сможет за один день потерять больше $50 notional.

---

### 🔧 Шаг 2 — Поднять порог минимальной прибыли (временно)

**Цель:** на live-тесте сделки с микро-прибылью ($0.02) не имеют смысла и только тратят gas. Поднимите порог, чтобы бот брал только явно прибыльные сделки.

Сейчас `dex.limits.minNetProfitUsd=0.02` — это 2 цента. Gas одной Arbitrum сделки ~$0.01-0.05. Сделка с netProfit $0.02 почти гарантированно уйдёт в минус после реального gas.

- [ ] **Поднять minNetProfitUsd до $0.50** (через config-service API):
  ```bash
  ssh arbibot-paper
  # Через HTTP API config-service (single-writer)
  curl -X PUT http://127.0.0.1:3019/policy/configurations/dex.limits \
    -H 'Content-Type: application/json' \
    -d '{"config_value":"{\"chains\":{\"42161\":{\"enabled\":true,\"maxGasPriceGwei\":30,\"maxGasPerTradeGwei\":5000000,\"maxPriorityFeeGwei\":1,\"maxNotionalPerTradeUsd\":15}},\"enabled\":true,\"killSwitch\":false,\"maxSlippageBps\":50,\"minNetProfitUsd\":0.50,\"maxOpenPositions\":1,\"maxDailyNotionalUsd\":50,\"maxNotionalPerTradeUsd\":15,\"requireTwoPersonApproval\":false,\"requireOperatorApprovalPerTrade\":false}","operatorId":"pre-live-checklist"}'
  ```
  Или через operator UI `/settings` → dex.limits → minNetProfitUsd: 0.50.

- [ ] **Проверить, что значение применилось**:
  ```bash
  curl -sf http://127.0.0.1:3019/policy/configurations/dex.limits/effective | grep minNetProfitUsd
  ```

> После live-теста можно вернуть обратно на $0.02, когда убедитесь, что алгоритм работает.

---

### 🪙 Шаг 3 — Проверить кошелёк и баланс

**Цель:** убедиться, что бот сможет платить за gas и trades.

- [ ] **Кошелёк активен в БД**: `prod-arb-1` (0xDea3...) — ✅ подтверждено.
- [ ] **ETH для gas**: минимум $5 (текущий ~$11 ETH — достаточно для ~100-200 tx при $0.05/tx).
  ```bash
  ssh arbibot-paper
  RPC=$(grep '^RPC_ARBITRUM_MAINNET_URL=' /root/Arbibot-2/.env | cut -d= -f2-)
  curl -sf -X POST "$RPC" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xDea3E1E8cF92349cab0b46095aE03732afB646f3","latest"],"id":1}'
  # result в wei, разделить на 1e18 = ETH
  ```
- [ ] **USDC для trades**: минимум $10 (текущий ~$44 — достаточно под потолок $10).
- [ ] **Приватный ключ расшифровывается**: EO должен логировать успешный decrypt при `submitLeg` (если увидите `decrypt failed` — ключ импортирован с другим `PRIVATE_KEY_ENCRYPTION_KEY` или `VAULT_MASTER_KEY_SALT`).

> Если ETH < $3 — пополнить кошелёк перед live (через биржу/другой кошелёк).

---

### 🚨 Шаг 4 — Подготовить аварийный стоп (kill-switch drill)

**Цель:** перед включением live убедиться, что вы знаете, как МГНОВЕННО остановить бота.

- [ ] **Открыть вторую SSH-сессию** с готовой командой:
  ```bash
  ssh arbibot-paper "cd /root/Arbibot-2 && npm run panic:stop"
  ```
  (Не запускать — просто держать готовой.)
- [ ] **Открыть SSH-туннель к Web UI** для мониторинга:
  ```bash
  ssh -L 3001:127.0.0.1:3001 arbibot-paper
  # Браузер: http://localhost:3001 → /execution → смотреть legs
  ```
- [ ] **Понять цепочку отката**:
  1. `npm run panic:stop` → kill-switch ON → новые legs блокируются
  2. In-flight legs **завершаются** (нельзя отозвать отправленную tx)
  3. `pm2 stop execution-orchestrator` → полная остановка
  4. `git checkout <hash из Шага 0>` → откат кода
  5. `npm run db:restore -- restore backups/arbibot_*.sql.gz` → откат БД (если migration)

> **Важно:** panic:stop НЕ отзывает уже отправленные транзакции. Если tx в mempool — она исполнится. Поэтому мониторьте в `/execution` и реагируйте быстро.

---

### ⚡ Шаг 5 — Включить `DEX_VENUE_ENABLED` (Блокер 1)

**Цель:** разблокировать on-chain adapter'ы. Это финальный «рубильник».

- [ ] **Установить env**:
  ```bash
  ssh arbibot-paper
  nano /root/Arbibot-2/.env
  # Добавить/найти: DEX_VENUE_ENABLED=true
  ```
- [ ] **Перезапустить EO (полный delete+start, не restart)**:
  ```bash
  pm2 delete execution-orchestrator
  cd /root/Arbibot-2 && set -a && . ./.env && set +a
  pm2 start ecosystem.paper.config.cjs --only execution-orchestrator
  pm2 save
  ```
- [ ] **Проверить, что venue gate открыт** — в логах больше не должно быть `DEX_VENUE_ENABLED is not "true"`:
  ```bash
  pm2 logs execution-orchestrator --lines 50 | grep -i "venue\|DEX_VENUE"
  ```

---

### 👀 Шаг 6 — Мониторинг первой live-сделки

**Цель:** проследить end-to-end, что сделка проходит все стадии без ошибок.

После Шага 5 бот начнёт подхватывать legs из `LegAutoDriverWorker`. Наблюдайте:

- [ ] **`submitLeg` прошёл** (лог EO):
  ```bash
  pm2 logs execution-orchestrator --lines 100 | grep -iE "submitLeg|markSent|broadcast|tx hash|on_chain"
  ```
  Ожидается: `Leg <id> markSent` без ошибок (раньше была `DEX_VENUE_ENABLED` error).

- [ ] **On-chain tx появилась в БД** (`on_chain_transactions` таблица):
  ```bash
  docker exec infra-postgres-1 psql -U arbibot -d arbibot -c \
    "SELECT id, tx_hash, status, created_at FROM on_chain_transactions ORDER BY created_at DESC LIMIT 5;"
  ```
  Ожидается: ≥1 строка с реальным `tx_hash` (0x...).

- [ ] **Tx подтвердилась на Arbiscan** (проверить hash):
  ```
  https://arbiscan.io/tx/<TX_HASH>
  ```
  Ожидается: Status = Success, не Reverted.

- [ ] **Balance кошелька уменьшился** на ожидаемую сумму (trade + gas):
  ```bash
  RPC=$(grep '^RPC_ARBITRUM_MAINNET_URL=' /root/Arbibot-2/.env | cut -d= -f2-)
  curl -sf -X POST "$RPC" -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xDea3...","latest"],"id":1}'
  ```

- [ ] **Reconciliation чистая** (0 mismatches после сделки):
  ```bash
  curl -sf http://127.0.0.1:3017/mismatches?status=open
  ```
  Ожидается: пустой массив (или только resolved historical).

- [ ] **Portfolio обновился** (позиция записана):
  ```bash
  docker exec infra-postgres-1 psql -U arbibot -d arbibot -c \
    "SELECT * FROM portfolio_positions ORDER BY updated_at DESC LIMIT 3;"
  ```

---

### 📊 Шаг 7 — Оценка результатов и решение

После 1-3 успешных live-сделок:

- [ ] **Фактический gas cost** сопоставим с estimate (~$0.01-0.05/tx)?
- [ ] **Slippage реальный** vs modeled — в пределах maxSlippageBps=50 (0.5%)?
- [ ] **Net profit** реальный > 0 (сделка принесла деньги, а не потеряла)?
- [ ] **Latency** end-to-end (opportunity → on-chain confirmation) разумная (< 2 мин)?

**Если всё зелёное:** live-тест прошёл. Можно постепенно поднимать `CAPITAL_MAX_ACTIVE_USD` и `maxNotionalPerTradeUsd`, наблюдая за поведением.

**Если что-то красное:**
1. `npm run panic:stop` немедленно.
2. Зафиксировать симптомы (логи, tx hash, balances).
3. Откатить `DEX_VENUE_ENABLED` (убрать или `=false`).
4. Разобраться перед повторной попыткой.

---

## Краткая шпаргалка (когда нужно действовать быстро)

```bash
# СТОП немедленно
ssh arbibot-paper "cd /root/Arbibot-2 && npm run panic:stop"

# Проверить состояние kill-switch
ssh arbibot-paper "curl -sf http://127.0.0.1:3012/metrics | grep arb_dex_live_halt_active"

# Восстановить (после разбора)
ssh arbibot-paper "cd /root/Arbibot-2 && npm run panic:recover"

# Полная остановка EO
ssh arbibot-paper "pm2 stop execution-orchestrator"

# Откатить код к стабильной версии
ssh arbibot-paper "cd /root/Arbibot-2 && git checkout <HASH-из-Шага-0> && npm run build -w @arbibot/execution-orchestrator && pm2 restart execution-orchestrator"
```

---

## Что НЕ делать

- ❌ **Не включайте `DEX_VENUE_ENABLED=true` без Шага 1** (capital ceiling = 0). Pipeline упадёт на `reserveCapital`.
- ❌ **Не поднимайте `CAPITAL_MAX_ACTIVE_USD` выше $10** на live-тесте (DoD Gate 3 limit).
- ❌ **Не оставляйте live без присмотра.** Arbitrum mainnet — реальные деньги. Первые сделки мониторьте активно.
- ❌ **Не правьте код прямо на сервере вне git** (как делал Hermes с `LATENCY_THRESHOLD_MS=500`). Изменения пропадут при следующем `git pull`. Все правки — через коммиты.
- ❌ **Не игнорируйте reconciliation mismatches.** Если после live-сделки появились open mismatches — это признак рассинхрона между БД и блокчейном. Разбираться до продолжения.

---

## Минимальный путь (если хочется быстро)

Если хочется проверить только «может ли бот отправить tx», без полного мониторинга:

```bash
# 1. Backup
ssh arbibot-paper "cp /root/Arbibot-2/.env /root/Arbibot-2/.env.bak.pre-live-\$(date +%Y%m%d)"

# 2. Установить CAPITAL_MAX_ACTIVE_USD=10 и DEX_VENUE_ENABLED=true
ssh arbibot-paper
nano /root/Arbibot-2/.env
# CAPITAL_MAX_ACTIVE_USD=10
# DEX_VENUE_ENABLED=true

# 3. Restart
pm2 delete execution-orchestrator
cd /root/Arbibot-2 && set -a && . ./.env && set +a
pm2 start ecosystem.paper.config.cjs --only execution-orchestrator
pm2 save

# 4. Наблюдать (в отдельной сессии)
pm2 logs execution-orchestrator --lines 50 | grep -iE "submitLeg|tx|on_chain|markSent|revert"

# 5. Если проблема — STOP
npm run panic:stop
```

Но рекомендуется пройти полный чек-лист — особенно Шаг 4 (kill-switch drill) и Шаг 6 (мониторинг).

---

*Составлено 2026-08-06 на основе фактического состояния стана Aéza (git `dae1620`). Все env-значения и конфиги верифицированы. Привязано к DoD Gate 3 (`docs/live-deploy-dod.md`).*
