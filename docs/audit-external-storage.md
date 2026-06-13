# Arbibot 2 — Audit Log External Storage

**Статус:** Phase C Reference — Draft v1
**Дата:** 2026-06-13
**Scope:** Перенос audit log из PostgreSQL в immutable external storage для tamper-evidence и долгосрочного хранения.

---

## 1. Цель

Текущий audit log живёт в PostgreSQL (`audit_entries` таблица). Это создаёт риски:
- **Tampering:** прямая DB-запись может изменить историю.
- **Loss:** при падении БД или migration error теряется история.
- **Volume:** рост таблицы замедляет остальные запросы.
- **Compliance:** для live trading требуется WORM-storage (write-once-read-many).

Документ описывает целевую архитектуру Phase C: **append-only external storage** с hash-chaining для tamper-evidence.

---

## 2. Целевая архитектура

```
┌──────────────────────────────────────────────────────────────────┐
│ Arbibot Microservices                                            │
│   - AuditClientService.appendEntry()                             │
└────────────┬─────────────────────────────────────────────────────┘
             │ synchronous HTTP to audit-service
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ audit-service                                                    │
│   1. Write to PostgreSQL (hot path, для UI queries)              │
│   2. Append to WAL buffer                                        │
│   3. Periodically flush to:                                      │
│      - S3 (WORM bucket, versioning + Object Lock)               │
│      - Loki (структурированный search)                          │
│      - Optional: ClickHouse (analytics queries)                 │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────────────┐
│ External Storage (Immutable)                                     │
│   - AWS S3 (Object Lock + Compliance mode)                       │
│   - GCP Cloud Storage (Bucket Lock)                              │
│   - Azure Blob (Immutable Policy)                                │
│   - Self-hosted: MinIO with WORM buckets                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Schema расширенной audit entry

Каждая запись содержит:
- `entry_id` (UUID v7 — timestamp-ordered)
- `ts` (ISO 8601 UTC)
- `actor` (operatorId | serviceId | hermes-agent)
- `action` (e.g. `force_hedge`, `config_promote`, `paper_trade_approve`)
- `entityType`, `entityId`
- `before` (JSON snapshot до действия)
- `after` (JSON snapshot после действия)
- `reason` (operator-provided)
- `correlationId`, `causationId`
- `prev_hash` (SHA-256 предыдущей записи → tamper-evident chain)
- `entry_hash` (SHA-256 всех полей + prev_hash)

### Hash-chaining алгоритм

```typescript
function computeEntryHash(entry: AuditEntry, prevHash: string): string {
  const canonical = JSON.stringify({
    entry_id: entry.entry_id,
    ts: entry.ts,
    actor: entry.actor,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before,
    after: entry.after,
    reason: entry.reason,
    correlationId: entry.correlationId,
    causationId: entry.causationId,
    prev_hash: prevHash,
  }, Object.keys(entry).sort());
  return createHash('sha256').update(canonical).digest('hex');
}
```

При verification: пересчитываем цепочку от genesis и сравниваем с сохранённой. Любая подмена нарушает chain.

---

## 4. Storage Layout

### 4.1 S3 (primary WORM storage)

```
s3://arbibot-audit-prod/
├── 2026/
│   ├── 06/
│   │   ├── 13/
│   │   │   ├── 00/
│   │   │   │   ├── 000000-001.jsonl.gz     # hour-sharded JSONL
│   │   │   │   ├── 000000-001.jsonl.gz.sha256
│   │   │   │   └── manifest.json            # batch metadata
│   │   │   ├── 01/
│   │   │   └── ...
│   │   └── 14/
│   └── ...
└── chain/
    ├── genesis.json
    ├── checkpoint-2026-06-13.json
    └── checkpoint-2026-06-14.json
```

**S3 Object Lock конфигурация:**
```json
{
  "ObjectLockEnabled": "Enabled",
  "Rule": {
    "DefaultRetention": {
      "Mode": "COMPLIANCE",
      "Days": 2555
    }
  }
}
```
Retention: **7 лет** (financial/compliance стандарт).

### 4.2 Loki (search)

Loki получает ту же запись через Promtail, но без `before`/`after` (экономия места):
```
label: { service="audit-service", actor_type="operator" }
line: { entry_id, ts, actor, action, entityId, severity }
```

### 4.3 PostgreSQL (hot cache, 30 days)

Только последние 30 дней — для UI operator dashboard. Старые записи партиционируются и удаляются по `detach + drop partition`.

```sql
CREATE TABLE audit_entries (
  entry_id UUID PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before JSONB,
  after JSONB,
  reason TEXT,
  correlation_id UUID,
  causation_id UUID,
  prev_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL
) PARTITION BY RANGE (ts);

CREATE TABLE audit_entries_2026_06 PARTITION OF audit_entries
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE INDEX idx_audit_actor_ts ON audit_entries_2026_06 (actor, ts DESC);
CREATE INDEX idx_audit_entity ON audit_entries_2026_06 (entity_type, entity_id);
```

---

## 5. Flush Pipeline (audit-service)

```
audit_entries (PostgreSQL) → audit_flush_worker (1min) → JSONL batch → S3 PUT → manifest
```

Worker логика:
1. `SELECT * FROM audit_entries WHERE flushed = false AND ts < now() - interval '5 minutes' ORDER BY ts`
2. Группируем по часам.
3. Сериализуем в JSONL, gzip.
4. Вычисляем batch hash (SHA-256 от concatenation entry_hash).
5. `s3.put_object` с Object Lock.
6. Записываем manifest.json с batch metadata.
7. `UPDATE audit_entries SET flushed = true WHERE entry_id IN (...)`.

**At-least-once:** duplicate flush OK (S3 versioning по `entry_id` ключу).

---

## 6. Verification Job

Ежедневный cron: `tools/verify-audit-chain.mjs` (Phase C TODO).

```typescript
// Псевдокод
const genesis = await s3.get('chain/genesis.json');
let prevHash = genesis.genesis_hash;

for await (const entry of iterateAuditLog({ from: '2026-06-13' })) {
  const expected = computeEntryHash(entry, prevHash);
  if (entry.entry_hash !== expected) {
    await alertSecurityTeam(`Audit chain broken at ${entry.entry_id}`);
    break;
  }
  prevHash = entry.entry_hash;
}

console.log(`✅ Verified ${count} entries, last hash: ${prevHash}`);
```

При расхождении → alert P1, расследование (см. `docs/incident-response-playbook.md`).

---

## 7. Retention & Cleanup

| Storage | Retention | Удаление |
|---------|-----------|----------|
| PostgreSQL (hot) | 30 days | `pg_partman` auto-drop partition |
| Loki | 90 days | `retention_period: 2160h` |
| S3 WORM | 7 years (compliance) | Object Lock COMPLIANCE mode — невозможно удалить |
| Optional: ClickHouse | 1 year | TTL on `ts` |

---

## 8. Operator UI Considerations

Operator dashboard `/incidents` и `/execution` страницы показывают audit:
- **Last 7 days** — из PostgreSQL (fast).
- **Older** — кнопка "Export from archive" → S3 presigned URL.

API: `GET /audit/export?from=...&to=...&format=jsonl` → streaming S3 download.

---

## 9. Migration Plan (Phase C)

1. **Week 1:** Включить S3 Object Lock bucket, обновить `audit-service` с hash-chaining.
2. **Week 2:** Реализовать flush worker + manifest. Партиционировать PostgreSQL.
3. **Week 3:** Backfill исторических записей (если есть) в S3.
4. **Week 4:** Реализовать verify job, подключить alert.
5. **Week 5:** Pen-test chain integrity (attempt tamper → detect).
6. **Week 6:** Live capital gate review.

---

## 10. Cost Estimation (annual)

| Storage | Volume | Cost (US-East-1) |
|---------|--------|------------------|
| S3 Standard | ~10 GB/year | ~$3/year |
| Loki (local disk) | ~5 GB/year | hardware cost |
| PostgreSQL (hot 30d) | ~500 MB | shared with OLTP |

**Итог:** negligible для paper/live deploy.

---

## 11. Acceptance Criteria

- [ ] S3 bucket с Object Lock COMPLIANCE, retention 7 years.
- [ ] audit-service пишет `prev_hash` + `entry_hash` на каждой записи.
- [ ] Flush worker запускается каждые 5 min, проверен под нагрузкой.
- [ ] Verify job ежедневно проверяет chain integrity.
- [ ] При tampering → P1 alert.
- [ ] Партиционирование PostgreSQL настроено, auto-drop работает.
- [ ] Migration runbook описан.
- [ ] Pen-test пройден (chain integrity attack detected).

---

## 12. References

- AWS S3 Object Lock — https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html
- Hash chaining — https://en.wikipedia.org/wiki/Hash_chain
- PCI DSS Requirement 10 — secure audit trails
- `docs/security-hardening-guide.md` — Phase C security roadmap
- `docs/threat-model.md` — T4 (audit log tampering)
- `docs/incident-response-playbook.md` — P1 incident response