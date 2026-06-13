# Security baseline (P0-0.3-SEC)

Черновик требований для Phase 1–2 инфраструктуры; согласован с разделом §8 архитектурной спеки (mTLS, идентичность сервисов, сегментация, секреты).

## Сервисная идентичность и транспорт

- **mTLS (целевое состояние):** каждый Nest-сервис в контуре `stage`/`prod` предъявляет клиентский сертификат при исходящих вызовах к peer-сервисам; ingress/API-gateway завершает TLS и проверяет клиентов операторского UI отдельно.
- **Идентификатор вызывающей стороны:** SPIFFE/SVID или эквивалент (PKI + short-lived certs); в логах и audit — стабильный `service_id` из `@arbibot/contracts` / переменных деплоя.
- **Dev:** HTTP без mTLS допустим; секреты только через env / secret store, не в репозитории (см. [`.env.example`](../.env.example)).

## Сегментация сети

- **Уровни:** сегмент «операторский edge» (dashboard, BFF), сегмент «синхронные доменные API», сегмент «данные» (PostgreSQL, Redis), сегмент «шина» (Kafka/Redpanda). Правила firewall: БД и брокер не доступны из интернета; только из списка сервисных аккаунтов.
- **East-west:** по умолчанию deny-all между сегментами; явные allow на порты и SNI, совпадающие с mTLS policy.

### Текущее состояние (paper-deploy, 2026-05-21)

> ⚠️ **Важно для оператора:** на текущем этапе **network isolation — единственный auth-фактор** для backend NestJS-сервисов. Ни один сервис (risk, opportunity, capital, execution, audit, canonical, intake, portfolio, reconciliation, paper, config) **не регистрирует auth guard глобально**. Исключение — `hermes-gateway` (`HermesAuthGuard` проверяет `x-hermes-api-key`).

- `infra/docker-compose.prod.yml` публикует наружу **только** `nginx:80`/`443`; все backend-сервисы в сети `arbibot-backend` без поля `ports:`.
- Это означает: любой backend-запрос `/execution/plans/:id/arm`, `/capital/reserve`, `/policy/jobs/*` из контура сети выполняется **без аутентификации**. Для trading-системы это acceptable для **paper-deploy**, но **блокер для live capital** (см. finding F1 в [`docs/pre-deploy-review.md`](pre-deploy-review.md)).
- Операционное правило: при любом изменении `infra/docker-compose.prod.yml` — ревью `ports:` секций на leak; никогда не публиковать прямые backend-порты без добавления auth guard.
- Целевое состояние для live: mTLS или HMAC service-to-service auth guard (см. [`docs/security-hardening-guide.md`](security-hardening-guide.md)).

## Секреты и ротация

- **Источник:** Vault / cloud secret manager / GitHub OIDC → short-lived credentials; запрет долгоживущих root-паролей в env файлах операторов.
- **Ротация:** API-ключи venue, DB passwords, TLS cert — политика срока жизни и автоматическое обновление без простоя (dual credential window где нужно).
- **Операторский UI:** роли (`viewer` / `operator` / `admin`) и approval для деструктивных действий — см. [`docs/operator-approval-flow.md`](operator-approval-flow.md).

## Следующие шаги (не в scope этого документа)

- Включение mTLS в compose/k8s manifests.
- Policy-as-code (OPA / встроенные guard) на gateway.
- Формальный threat model и pen-test перед live.
