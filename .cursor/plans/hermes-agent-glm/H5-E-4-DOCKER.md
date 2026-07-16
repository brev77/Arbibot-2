# H5-E-4-DOCKER — Профиль hermes-agent в dev-compose

| Поле | Значение |
|------|----------|
| **depends_on** | `H5-D-3-SCRIPTS` |
| **risk_level** | `low` (опциональный профиль) |
| **status** | done |

## Outputs
- `infra/docker-compose.dev.yml` — сервис `hermes-agent` (профиль `[hermes-agent]`) + volume `arbibot_hermes_agent_data` + комментарий в шапке.

## Конфигурация
- Образ `python:3.11-slim` (шаблон); команда ставит бинарник `hermes` и запускает `hermes run --config /config/hermes-config.yaml`.
- `env_file: ../.env`; `HERMES_GATEWAY_URL` → `host.docker.internal:3020` (gateway на хосте).
- Volumes: `tools/hermes-agent` (ro), собранный `packages/hermes-mcp-server/dist` (ro), именованный volume для памяти.
- `extra_hosts: host.docker.internal:host-gateway`.
- Запуск: `npm run dev:stack:hermes-agent` или `docker compose -f infra/docker-compose.dev.yml --profile hermes-agent up -d`.

## Edge Cases
- Профиль выключен по умолчанию — обычный `docker compose up` его не поднимает.
- Публичного официального образа Hermes Agent нет → оставлен `# TODO` для подстановки своей сборки.
- `packages/hermes-mcp-server/dist` монтируется ro после `npm run build:hermes-mcp`.

## Test
```bash
docker compose -f infra/docker-compose.dev.yml --profile hermes-agent config >/dev/null && echo "compose valid"
```
