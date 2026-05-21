# Arbibot 2 — Capacity Planning & Sizing Guide

**Версия:** 1.0  
**Дата:** 2026-05-21  
**Применимость:** Paper trading → Live trading

---

## 1. Resource Requirements — Minimum (Paper Trading)

### Сервер (одна VM / bare-metal)

| Ресурс | Minimum | Recommended | Примечание |
|--------|---------|-------------|------------|
| **CPU** | 8 cores | 16 cores | 12 NestJS + nginx + observability |
| **RAM** | 16 GB | 32 GB | См. breakdown ниже |
| **Disk** | 100 GB SSD | 200 GB NVMe | DB + logs + backups |
| **Network** | 100 Mbps | 1 Gbps | Market data throughput |

### RAM Breakdown

| Компонент | Memory Limit | Min Reservation | Кол-во |
|-----------|-------------|-----------------|--------|
| PostgreSQL | 2 GB | 512 MB | 1 |
| Redis | 512 MB | — | 1 |
| Redpanda | 2 GB | — | 1 |
| NestJS services (12×) | 512 MB each | 128 MB each | 12 = **6 GB total** |
| Execution orchestrator | 1 GB | — | 1 |
| Next.js (web) | 1 GB | 256 MB | 1 |
| nginx | 128 MB | — | 1 |
| Prometheus | 1 GB | — | 1 |
| Grafana | 512 MB | — | 1 |
| Loki | 512 MB | — | 1 |
| Promtail | 256 MB | — | 1 |
| PgBouncer | 64 MB | — | 1 |
| Alertmanager | 64 MB | — | 1 |
| **TOTAL** | **~16 GB** | **~4 GB** | — |

> **Вывод:** 16 GB RAM достаточно для paper trading. 32 GB рекомендуется для production с live capital.

---

## 2. PostgreSQL Sizing

### Ожидаемый рост данных

| Таблица | Записей/день (paper) | Записей/день (live) | Размер/год |
|---------|----------------------|---------------------|------------|
| `market_snapshots` | ~50K | ~500K | ~5 GB |
| `risk_decisions` | ~1K | ~10K | ~100 MB |
| `execution_plans` | ~100 | ~1K | ~10 MB |
| `execution_legs` | ~200 | ~2K | ~20 MB |
| `outbox_events` | ~1K | ~10K | ~200 MB |
| `paper_trades` | ~500 | N/A | ~50 MB |
| `audit_log` | ~2K | ~20K | ~500 MB |
| `schema_migrations` | static | static | negligible |

### Рекомендации

- **Paper trading:** 50 GB disk достаточно на 1+ год
- **Live trading:** 100+ GB, рассмотреть partitioning для `market_snapshots`
- **Vacuum:** настроить `autovacuum` (default в PostgreSQL 16)
- **Indexes:** миграции создают необходимые indexes

### Connection Pooling

- **PgBouncer:** transaction mode, 25 pool size, 200 max client connections
- Каждый NestJS сервис открывает ~5 connections через TypeORM
- 12 сервисов × 5 = 60 connections — в пределах pool

---

## 3. Redis Sizing

| Использование | Expected Size | TTL |
|---------------|--------------|-----|
| Config cache | < 1 MB | 60s |
| Session tokens | < 1 MB | 24h |
| Policy cache (intake) | < 1 MB | env-configured |
| Paper discovery config | < 1 MB | env-configured |

**Рекомендация:** 256 MB max memory с `allkeys-lru` eviction. Вполне достаточно.

---

## 4. Network Bandwidth

### Market Data Intake

| Метрика | Paper | Live |
|---------|-------|------|
| Updates/sec | 10–50 | 100–500 |
| Avg message size | 500 bytes | 500 bytes |
| Bandwidth | ~25 KB/s | ~250 KB/s |

### Kafka / Redpanda

| Метрика | Paper | Live |
|---------|-------|------|
| Events/sec | 1–10 | 10–100 |
| Avg event size | 2 KB | 2 KB |
| Daily volume | ~1 GB | ~10 GB |

**Retention:** 7 дней (Redpanda default). Disk usage: ~7 GB (paper), ~70 GB (live).

---

## 5. Scaling Strategy

### Vertical (одна VM)

```
Paper Trading (16 GB) → Live Minimal (32 GB) → Live Full (64 GB)
```

Просто увеличить VM size. Docker compose перезапустится с новыми limits.

### Horizontal (несколько VM — future)

Когда вертикальное масштабирование недостаточно:

1. **PostgreSQL** → managed RDS или read replicas
2. **NestJS services** → запустить несколько инстансов за load balancer
3. **Redis** → Redis Cluster или managed ElastiCache
4. **Redpanda** → кластер из 3 nodes

> **Примечание:** Horizontal scaling не требуется для initial paper trading.

---

## 6. Monitoring Resource Usage

### Key Metrics

```bash
# CPU/Memory per container
docker stats --no-stream

# PostgreSQL disk usage
docker exec <postgres> psql -U arbibot -c "
  SELECT pg_size_pretty(pg_database_size('arbibot'));
"

# Redis memory
docker exec <redis> redis-cli INFO memory | grep used_memory_human

# Docker disk
docker system df
```

### Alerts (уже настроены)

- `HighMemoryUsage` — service > 400 MB resident
- Prometheus scrape показывает resource usage

---

## 7. Cost Estimation (Cloud)

### Paper Trading (одна VM)

| Провайдер | Instance | CPU | RAM | Disk | Monthly Cost |
|-----------|----------|-----|-----|------|-------------|
| Hetzner | CX42 | 8 vCPU | 16 GB | 160 GB | ~€40 |
| DigitalOcean | g-8vcpu-16gb | 8 vCPU | 16 GB | 200 GB | ~$130 |
| AWS | r6g.2xlarge | 8 vCPU | 32 GB | 200 GB EBS | ~$400 |
| GCP | n2-highmem-8 | 8 vCPU | 52 GB | 200 GB SSD | ~$350 |

### Live Trading (рекомендуемый)

| Провайдер | Instance | CPU | RAM | Disk | Monthly Cost |
|-----------|----------|-----|-----|------|-------------|
| Hetzner | CX52 | 16 vCPU | 32 GB | 320 GB | ~€80 |
| AWS | r6g.4xlarge | 16 vCPU | 64 GB | 500 GB EBS | ~$800 |

> **Рекомендация:** Для paper trading достаточно Hetzner CX42 (~€40/мес). Для live — CX52 или эквивалент.

---

## 8. Growth Planning

| Стадия | CPU | RAM | Disk | Когда |
|--------|-----|-----|------|-------|
| Paper initial | 8 cores | 16 GB | 100 GB | Старта |
| Paper mature | 8 cores | 16 GB | 200 GB | Через 6 мес |
| Live minimal | 16 cores | 32 GB | 200 GB | Переход на live |
| Live full | 32 cores | 64 GB | 500 GB+ | Полная нагрузка |