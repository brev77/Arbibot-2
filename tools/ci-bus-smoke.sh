#!/usr/bin/env bash
# Bus profile smoke: Redpanda (Kafka API) up + outbox-kafka-bridge build artifacts.
# Full publish/consume against real outbox rows is a separate manual/staging check; see docs/outbox-inbox.md.
#
# Windows + Docker Desktop: if `npm run ci:bus-smoke` invokes bash in WSL without /var/run/docker.sock,
# docker compose will fail. Fix: enable WSL2 integration in Docker Desktop for your distro, or run the
# same steps from PowerShell in the repo root:
#   docker compose -f infra/docker-compose.dev.yml --profile bus up -d
#   Start-Sleep -Seconds 8
#   npm run build -w @arbibot/outbox-kafka-bridge
#   Test-Path packages/outbox-kafka-bridge/dist/bin/publish.js; Test-Path .../consume.js
#   docker compose -f infra/docker-compose.dev.yml --profile bus down

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "ci-bus-smoke: docker not found; skipping compose (install Docker for full check)" >&2
else
  docker compose -f infra/docker-compose.dev.yml --profile bus up -d
  cleanup() {
    docker compose -f infra/docker-compose.dev.yml --profile bus down >/dev/null 2>&1 || true
  }
  trap cleanup EXIT
  # Allow broker to listen on 19092
  sleep 8
fi

npm run build -w @arbibot/outbox-kafka-bridge
test -f packages/outbox-kafka-bridge/dist/bin/publish.js
test -f packages/outbox-kafka-bridge/dist/bin/consume.js

# Optional: seed one outbox row for manual publish/consume against real data (requires DATABASE_URL).
if [[ "${SEED_OUTBOX:-}" == "1" ]] && [[ -n "${DATABASE_URL:-}" ]]; then
  node tools/seed-outbox-events.mjs
fi

echo "ci-bus-smoke: ok (bridge built; broker up if docker compose ran)"
