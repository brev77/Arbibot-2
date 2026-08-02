---
name: scanner_status
description: "Сводка работы cross-DEX сканера: статус инстансов, последние findings, spread/volume"
readonly: true
tools:
  - get_scanner_status
  - list_scanner_findings
---

# Skill: scanner-status

## Когда использовать
- "что нашёл сканер?", "scanner status", "scanner report"
- "какие арбитражные возможности сейчас?"
- "покажи последние scanner findings"
- Cron: ежедневный отчёт по работе сканера

## Trigger Patterns
- "scanner status"
- "статус сканера"
- "что нашёл сканер"
- "scanner findings"
- "cross-dex spreads"
- "арбитражные возможности"

## Последовательность вызовов

1. `get_scanner_status` — runtime статус worker
   - `scheduledInstanceIds` — какие инстансы запланированы
   - `runningInstanceIds` — какие сейчас в цикле
   - `isShuttingDown` — graceful shutdown

2. `list_scanner_findings` — последние findings (limit=10)
   - Параметры: `publishStatus` (опц.), `instanceId` (опц.)
   - Поля: spreadBps, netProfitUsd, buyVenue/sellVenue, canonicalToken, chainId, publishStatus

3. Анализ:
   - Подсчитать findings по publishStatus (published / pending / failed)
   - Выделить топ-3 по spreadBps (самые выгодные спреды)
   - Отметить failed findings (требуют attention — opportunity-service down?)
   - Группировка по instance / chain / venue pair

## Формат ответа

```
🔍 **Scanner status**

**Worker:** {N} scheduled, {M} running{, shutting down}
**Instances:** arb-2venue-1 (arbitrum), arb-2venue-2 (base)

📊 **Findings (last {limit})**
- Published: {published_count} → sent to opportunity-service
- Pending: {pending_count} → в очереди на публикацию
- Failed: {failed_count} → ⚠️ требуют внимания (orphan worker retrying)

📈 **Top spreads**
1. {token} {chain}: {spread}bps, net ${net} — buy {buyVenue} → sell {sellVenue} {published/pending}
2. {token} {chain}: {spread}bps, net ${net} — buy {buyVenue} → sell {sellVenue} {published/pending}
3. {token} {chain}: {spread}bps, net ${net} — buy {buyVenue} → sell {sellVenue} {published/pending}

{if failed > 0:}
⚠️ **Внимание:** {failed_count} findings не опубликованы (opportunity-service недоступен?).
Orphan worker делает повторы (max 5 attempts). Проверь `/scanners` в UI для manual re-publish.
```

## Заметки
- **Read-only skill** — не запускает/останавливает инстансы (это через `/settings` UI).
- Findings — raw cross-venue deals; published → opportunity в opportunity-service.
- spreadBps — gross spread (buy − sell); netProfitUsd = gross − pool fees − gas (БЕЗ slippage).
- Если worker `shutting down` — сообщить оператору, что сканер останавливается.
- publishStatus `failed` после max attempts (5) — terminal, требует manual re-publish через UI.

## Связанные tools (read-only)
- `get_scanner_status` — runtime статус
- `list_scanner_findings` — список findings (фильтры по instance/status)

## Управление конфигурацией
Для изменения `scanner.instances` / `scanner.defaults` через Hermes — см. skill `config-management`
(keys `scanner.*` в allowlist, safe для мутаций через Telegram).
