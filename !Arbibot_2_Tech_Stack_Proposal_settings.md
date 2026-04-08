# Arbibot 2 — рекомендуемый стек

Этот документ не заменяет основную архитектуру, а предлагает практический стек для реализации Arbibot 2 и его OpenClaw-интеграции.

## Принципы выбора стека

* Сильная поддержка TypeScript и Python
* Предсказуемая работа с event-driven и stateful контурами
* Хорошая наблюдаемость и контейнеризация
* Простая интеграция с OpenClaw как self-hosted gateway ([OpenClaw docs](https://docs.openclaw.ai))

## Backend

* Основной язык orchestration и API: TypeScript
* Для heavy analytics, research jobs, simulation, recalibration: Python
* Runtime: Node 24 LTS-class для TypeScript сервисов, совместимо с рекомендациями OpenClaw ([OpenClaw docs](https://docs.openclaw.ai), [getting started](https://github.com/openclaw/openclaw/blob/main/docs/start/getting-started.md))
* API framework: NestJS или Fastify
* Background workers: Temporal или BullMQ

## Data layer

* Primary OLTP DB: PostgreSQL
* Cache / ephemeral coordination: Redis
* Event streaming: Kafka или Redpanda
* Object storage для replay и snapshots: S3-compatible storage
* Analytics store при росте: ClickHouse

## Messaging и contracts

* Synchronous APIs: REST + internal RPC
* Async contracts: Kafka / Redpanda topics
* Schema contracts: JSON Schema + AsyncAPI
* HTTP contracts: OpenAPI

## Execution и adapters

* CEX adapters: TypeScript services with strict rate-limiting
* DEX / chain adapters: TypeScript + optional Python helpers for research / routing analysis
* RPC provider layer: multi-provider strategy
* Nonce / gas / mempool utilities: isolated operational components

## Observability

* Metrics: Prometheus
* Dashboards: Grafana
* Logs: Loki или ELK/OpenSearch
* Tracing: OpenTelemetry + Tempo / Jaeger
* Alerting: Alertmanager + Telegram/Slack/PagerDuty integration

## Frontend

* Web app: Next.js
* UI layer: React + TypeScript
* Component system: shadcn/ui or similar design system
* Charts: ECharts or Recharts
* Tables: TanStack Table
* State management: React Query + Zustand

## Infrastructure

* Containers: Docker
* Orchestration: Kubernetes или Nomad на более позднем этапе
* CI/CD: GitHub Actions
* Secrets: Vault или managed secret store
* Infra-as-code: Terraform

## OpenClaw layer

* OpenClaw Gateway как отдельный self-hosted service ([OpenClaw docs](https://docs.openclaw.ai))
* Onboarding и daemonized setup через openclaw onboard –install-daemon ([getting started](https://github.com/openclaw/openclaw/blob/main/docs/start/getting-started.md))
* Browser dashboard / Control UI для agent workflows ([OpenClaw docs](https://docs.openclaw.ai), [getting started](https://github.com/openclaw/openclaw/blob/main/docs/start/getting-started.md))
* Отдельный Arbibot Operator API для OpenClaw skills

## Стек по стадиям

### Stage 1

* PostgreSQL
* Redis
* NestJS/Fastify
* Next.js
* Prometheus + Grafana
* GitHub Actions

### Stage 2

* Kafka / Redpanda
* OpenTelemetry
* Object storage replay layer
* OpenClaw integration layer

### Stage 3

* ClickHouse
* Kubernetes / Nomad
* Advanced replay and simulation stack

## Дорожная карта развития стека

### Фаза A — foundation stack

* PostgreSQL
* Redis
* NestJS/Fastify
* Next.js
* Prometheus + Grafana
* GitHub Actions

### Фаза B — execution stack

* Kafka / Redpanda
* OpenTelemetry
* richer adapter layer
* alerting stack
* operator API layer

### Фаза C — paper and analytics stack

* object storage replay layer
* ClickHouse
* analytics jobs
* token quality pipelines

### Фаза D — OpenClaw and automation stack

* dedicated OpenClaw Gateway host or service
* Operator API for OpenClaw
* approvals and action policy integration
* incident briefing workflows

## Критерии выбора технологий по фазам

* На ранних стадиях предпочтение простоте и предсказуемости.
* На средних стадиях предпочтение observability и replayability.
* На поздних стадиях предпочтение breadth scaling и operator automation.

## Слой конфигурации и policy storage

Для Arbibot 2 рекомендуется выделить настройки в отдельный конфигурационный слой, а не хранить все только в .env и статических файлах.

### Рекомендуемые компоненты

* PostgreSQL как authoritative policy store
* Redis для config cache и fast invalidation
* Config loader library в каждом сервисе
* Control Plane API для чтения и изменения effective settings
* Audit trail для config changes

### Что хранить в policy store

* global settings
* arbitrage class settings
* venue and network settings
* token tier settings
* execution and risk policy settings
* OpenClaw settings

### Что оставить в env

В .env стоит оставить только: - secrets - bootstrap URLs - DB / Redis / Kafka connection strings - feature flags раннего старта - emergency boot toggles

### Что нельзя держать только в env

* min\_arbitrage\_spread\_percent
* enable\_cex\_dex / enable\_dex\_dex / enable\_funding\_arbitrage и другие policy flags
* venue allowlists / denylists
* paper promotion thresholds
* runtime risk limits

## Дорожная карта конфигурационного слоя

### Stage Config-1

* config tables in PostgreSQL
* read-only config API
* config cache

### Stage Config-2

* config edit API
* approvals for sensitive settings
* config audit history

### Stage Config-3

* staged rollout of settings
* rollback support
* per-scope overrides