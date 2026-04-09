# Observability baseline (P1-1.1-OBS)

- **Correlation:** заголовок `x-correlation-id`; pre-handler в Nest (`@arbibot/nest-platform`) кладёт значение в AsyncLocalStorage; обёртка `withCorrelation` для логов.
- **Логи:** структурированный JSON — следующий шаг: Pino transport в сервисах.
- **Метрики:** Prometheus scrape endpoints — Phase 2 инфраструктура.
- **Трейсы:** OpenTelemetry SDK + экспорт в Tempo/Jaeger — после стабилизации sync цепочки.
