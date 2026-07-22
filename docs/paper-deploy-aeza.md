# Paper Deploy — Aéza Frankfurt (arbibot2-fr)

**Дата развёртывания:** 2026-07-22
**Сервер:** Aéza CLT-3 Dedicated, 4 vCPU / 8 GB / 120 GB NVMe
**Локация:** Frankfurt, DE (`arbibot2-fr`, `79.137.202.225`)
**Фаза:** Paper validation (виртуальный капитал, без реальных кошельков)

## Почему эта локация

Latency до ключевых endpoint'ов (измерено 2026-07-22):

| Endpoint | RTT | Оценка |
|---|---|---|
| api.binance.com | 1.08 мс | 🟢 |
| api.bybit.com | 0.93 мс | 🟢 |
| arb1.arbitrum.io (Arbitrum RPC) | 1.17 мс | 🟢 |
| mainnet.base.org (Base RPC) | 1.15 мс | 🟢 |
| OKX (HTTPS) | 5.3 мс connect | 🟢 |
| BNB Ankr RPC | 4.1 мс connect | 🟢 |

## Hardening (выполнено)

- ✅ SSH key-only auth (password disabled)
- ✅ Root password сменён (старый засвеченный пароль мёртв)
- ✅ `PermitRootLogin prohibit-password`
- ✅ ufw: 22/80/443, остальное deny
- ✅ fail2ban sshd jail (5 попыток → бан 1ч, incremental)
- ✅ Swap 4 GB (`/swapfile`, в fstab)

## Стек

| Компонент | Версия |
|---|---|
| OS | Ubuntu 26.04 LTS |
| Docker Engine | 29.6.2 |
| Docker Compose | v5.3.1 |
| Node.js | v22.23.1 (nvm) |
| npm | 10.9.8 |
| pm2 | 7.0.3 |
| PostgreSQL | 16.14 (docker) |
| Redis | 7 (docker) |

## Запущенные сервисы (pm2)

| Сервис | Порт | RAM | Назначение |
|---|---|---|---|
| risk-service | 3000 | ~126 MB | risk decisions |
| opportunity-service | 3010 | ~128 MB | opportunities, paper-enqueue |
| audit-service | 3013 | ~128 MB | audit log |
| market-intake-service | 3015 | ~129 MB | snapshots ingestion |
| paper-trading-service | 3018 | ~134 MB | paper trades, discovery |
| config-service | 3019 | ~128 MB | policy config |
| web (Next.js) | 3001 | ~158 MB | operator UI |

pm2 startup настроен (systemd). При ребуте сервера все сервисы поднимаются автоматически (`pm2 save` выполнен).

## Доступ к Web UI (через SSH-туннель)

Web UI **не** выставлен в интернет напрямую (нет домена/TLS, небезопасно). Доступ через SSH-туннель с локальной машины:

```bash
ssh -L 3001:127.0.0.1:3001 arbibot-paper
```

Затем открыть в браузере: `http://localhost:3001`

Первая загрузка потребует login. Для paper-фазы используется dev-role bypass через `ARBIBOT_DEV_ROLE=viewer` (для live убрать).

## Ключевые env-vars (paper-фаза)

| Переменная | Значение | Назначение |
|---|---|---|
| `DEX_LIVE_KILL_SWITCH` | `true` | аварийный стоп всегда включён |
| `DEX_LIVE_ENABLED` | `false` | live торговля выключена |
| `ARBIBOT_SERVICE_AUTH_ENABLED` | `false` | dev/paper runs unsigned (по hermes-gateway/README.md) |
| `PAPER_DISCOVERY_ENABLED` | `true` | discovery worker активен |
| `PAPER_DISCOVERY_PAPER_ONLY_TOKENS` | `BTC,ETH,SOL` | paper-only whitelist (контаминация с live) |
| `PAPER_DISCOVERY_PAPER_ONLY_ROUTES` | `BTC-USDT-BIN-BYB,...` | paper-only routes |
| `MARKET_INTAKE_SERVICE_URL` | `http://127.0.0.1:3015` | для discovery fetch snapshots |
| `OPERATOR_SESSION_SECRET` | `<generated>` | JWT signing |
| `ARBIBOT_SERVICE_AUTH_SECRET` | `<generated>` | HMAC (для live) |

## Smoke-тест (пройден 2026-07-22)

Pipeline verification: `snapshot ingest → discovery → candidate → processed`

1. Отправлен тестовый BTC snapshot через `POST /snapshots/ingest` (binance bid=65000, bybit bid=65200)
2. **Важно:** `instrumentKey` и `routeKey` должны быть внутри поля `payload` (не top-level), иначе discovery их не увидит
3. Discovery cycle каждые 30 сек нашёл 2 snapshot'а, профилировал 2 кандидата, 1 обработан
4. В БД `paper_discovery_candidates`: BTC/BTC-USDT-BIN-BYB, profit $10, score 0.9985, status `processed` ✅

### Нюанс discovery → paper trade

Discovery меняет статус кандидата на `processed` и пишет audit, но **не создаёт автоматически paper trade**. Это by-design (`paper-discovery.service.ts:456` — "would be injected in real implementation"). Paper trade создаётся оператором через UI или через `POST /opportunities/:id/paper-enqueue` flow.

## verify:env результат

- **16 PASS** (kill-switch, DEX_LIVE off, discovery on, service URLs, metrics, no placeholders)
- **7 FAIL** (TLS certs, alertmanager, ARBIBOT_DEV_ROLE — все ожидаемы для paper, не нужны до live)
- **4 WARN** (Slack/PagerDuty, PgBouncer, Kafka, localhost CORS — приемлемо для paper)

## Полезные команды

```bash
# Подключение
ssh arbibot-paper

# Статус сервисов
pm2 list

# Логи конкретного сервиса
pm2 logs paper-trading-service --lines 50

# Перезапуск сервиса после правки .env (нужен полный delete+start, не restart --update-env)
pm2 delete paper-trading-service
cd /root/Arbibot-2 && pm2 start ecosystem.paper.config.cjs --only paper-trading-service

# БД прямые запросы
docker exec infra-postgres-1 psql -U arbibot -d arbibot -c "SELECT ..."

# Проверка миграций
cd /root/Arbibot-2 && set -a && . ./.env && set +a && npm run db:verify-migrations:all

# Бэкап БД
cd /root/Arbibot-2 && npm run db:backup

# Panic stop (если что-то пошло не так)
cd /root/Arbibot-2 && npm run panic:stop
```

## Путь к live-фазе

1. Убрать `ARBIBOT_DEV_ROLE` из `.env` (требует реальный operator login)
2. Включить `ARBIBOT_SERVICE_AUTH_ENABLED=true` (HMAC между сервисами)
3. Настроить TLS (домен + Let's Encrypt или self-signed через `npm run generate:tls`)
4. Настроить alertmanager (Slack webhook или PagerDuty)
5. Отдельный сервер под БД (`CLT-4`) для live (разделение ответственности)
6. Ввести wallet keys через operator UI/CLI (НЕ через чат/SSH)
7. Flip `DEX_LIVE_KILL_SWITCH=false` → `DEX_LIVE_ENABLED=true` (по operator approval)

См. `docs/paper-deploy-dod.md` для полного DoD live-gate.

## Hermes stack — статус и известные проблемы (2026-07-22)

### Что работает ✅

| Компонент | Статус | Проверка |
|---|---|---|
| **hermes-gateway** (NestJS :3020) | ✅ работает | `/hermes/v1/plans`, `/positions`, `/incidents` → HTTP 200 |
| **hermes-mcp-server** (22 tools) | ✅ собран | подключается к gateway через stdio |
| **hermes-agent** v0.17.0 binary | ✅ установлен | `hermes --version` → v0.17.0 (2026.6.19) |
| **doctor:hermes** | ✅ пройден | все 4 секрета валидны |
| **Telegram bot token** | ✅ валиден | `getMe` через curl → `ok:true`, бот `@Arbi2_hermes_bot` |
| **Web UI `/hermes`** | ✅ доступен | через SSH-туннель, ходит к gateway |

### Применённые фиксы (полезны независимо от agent)

1. **`/etc/gai.conf`** — `precedence ::ffff:0:0/96 100` (IPv4 over IPv6). Python dual-stack hang 10с → 0.1с.
2. **`/etc/hosts`** — `149.154.166.110 api.telegram.org` (pin на рабочий IP, обход DoH fallback на недоступный 91.108.4.5).

### ⚠️ КРИТИЧЕСКИЙ БАГ В ПРОЕКТЕ: `hermes run` не существует

**`tools/run-hermes-agent.mjs:53`** вызывает `hermes run --config ...`, но **ни одна upstream версия hermes-agent (0.13–0.19) не имеет команды `run`**. Это баг в проектном коде, который никогда не ловился, т.к. nobody не запускал agent end-to-end до этого деплоя.

**Доказательство:** проверены все версии через `pip install`:
- v0.13.0, v0.14.0, v0.15.x, v0.16.0, **v0.17.0** (Plan 5), v0.18.x, v0.19.0 — **ни одна** не имеет `run`.
- `hermes --help` список: `chat, model, gateway, setup, status, cron, ...` — `run` отсутствует.
- Строка `hermes gateway run` **не встречается нигде** в репо (tools/, docs/, .cursor/plans/).

**Correct invocation:** `hermes gateway run` (messaging gateway — Telegram/Discord/cron service).

### ⚠️ РЕШЕНО: Telegram adapter + GLM endpoint (все блокеры сняты 2026-07-22)

**Pipeline полностью работает end-to-end:**
```
Operator → Telegram → Agent (v0.19.0) → GLM 5.2 (api.z.ai/api/coding/paas/v4) → MCP → Gateway → ответ в Telegram
```

Было 3 блокера, все сняты последовательно:

#### Блокер 1 — Telegram adapter зацикливался на "Connecting (attempt 1/8)"
**Причина:** Hermes-agent v0.17+ НЕ активирует Telegram из env-vars — требует секцию `platforms.telegram` в `~/.hermes/config.yaml`. Доп. фактор: `/etc/hosts` pin на IP ломал TLS SNI.
**Решение:** секция `platforms.telegram` в config.yaml + убрать `/etc/hosts` pin.
GitHub issues: [#67498](https://github.com/NousResearch/hermes-agent/issues/67498), [#68465](https://github.com/NousResearch/hermes-agent/issues/68465).

#### Блокер 2 — `open.bigmodel.cn` (Китай) timeout из EU
**Причина:** Китайский endpoint недоступен из EU дата-центров (connect timeout). Международный `api.z.ai` работает (0.66с).
**Решение:** `base_url: https://api.z.ai/api/coding/paas/v4` в config.yaml + `GLM_BASE_URL` env override (для hermes-agent v0.19 native zai provider, который игнорирует `HERMES_LLM_BASE_URL`).

#### Блокер 3 — `HTTP 429 code 1113 "Insufficient balance"` с Coding Plan
**Причина:** GLM Coding Plan (месячная подписка) работает **только** через `api.z.ai/api/coding/paas/v4`. На endpoint `/api/paas/v4` тот же ключ вернёт 429 code 1113 "Insufficient balance" (требует pay-per-token баланса).
**Решение:** правильно выбран coding endpoint.
Документация: [Z.AI API error codes](https://docs.z.ai/api-reference/api-code), [Usage Policy](https://docs.z.ai/devpack/usage-policy).

#### Все обходы (server-specific, не в репо)
1. `~/.hermes/config.yaml` → секция `platforms.telegram` (обход для v0.17/0.19)
2. `~/.hermes/config.yaml` → `model.base_url: https://api.z.ai/api/coding/paas/v4`
3. `~/.hermes/.env` → `GLM_BASE_URL=https://api.z.ai/api/coding/paas/v4` (override для native zai provider)
4. `/etc/gai.conf` → IPv4 precedence (Python dual-stack hang fix)
5. Удалён `/etc/hosts` pin (ломал TLS SNI)
6. `~/.hermes/auth.json` → `credential_pool.zai[0].base_url: https://api.z.ai/api/coding/paas/v4`

Подробное руководство по обходам: [H5-G-RUNTIME.md](../.cursor/plans/hermes-agent-glm/H5-G-RUNTIME.md).
Backup конфигов v0.17: `/root/hermes-backup-v0.17/`.

### Секреты Hermes (хранение)

- `~/.hermes/.env` — GLM_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USERS (права 600)
- `/root/.hermes_api_key_secret` — HERMES_API_KEY для gateway (права 600)
- `/root/Arbibot-2/.env` — те же значения продублированы для gateway/MCP

### Команды для возобновления работы над agent

```bash
# Проверить статус
ssh arbibot-paper "pm2 describe hermes-agent | grep status"

# Логи adapter'а
ssh arbibot-paper "pm2 logs hermes-agent --lines 50"

# Ручной запуск (foreground, для дебага)
ssh arbibot-paper "cd /root/.hermes && rm -f gateway.lock gateway.pid && hermes gateway run"

# Проверить конфликт Telegram-сессий
TG_TOKEN=$(ssh arbibot-paper "grep TELEGRAM_BOT_TOKEN /root/.hermes/.env | cut -d= -f2")
curl -s "https://api.telegram.org/bot${TG_TOKEN}/getUpdates?timeout=3"
```

### Влияние на paper validation

Hermes — операторский слой (Telegram-сводки, config-mutations через Plan 6). После снятия всех блокеров (2026-07-22) **pipeline полностью работает**: operator отправляет `/status` боту `@Arbi2_hermes_bot` в Telegram → agent (GLM 5.2) отвечает, используя данные из gateway (dashboard, plans, positions, incidents). Требуется активная GLM Coding Plan подписка на https://z.ai.
