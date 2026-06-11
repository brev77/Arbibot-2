#!/usr/bin/env bash
# Build all Arbibot 2 Docker images from monorepo root.
# Usage: bash tools/docker-build-all.sh [--push] [--registry REGISTRY] [--tag TAG]
#
# Defaults:
#   REGISTRY = ghcr.io/brev77
#   TAG      = latest
#
# Prerequisites:
#   - Docker BuildKit enabled
#   - Logged into registry (docker login ghcr.io ...)
#
# Examples:
#   bash tools/docker-build-all.sh
#   bash tools/docker-build-all.sh --push --registry ghcr.io/myorg --tag v1.0.0

set -euo pipefail

REGISTRY="${REGISTRY:-ghcr.io/brev77}"
TAG="${TAG:-latest}"
PUSH=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)     PUSH=true; shift ;;
    --registry) REGISTRY="$2"; shift 2 ;;
    --tag)      TAG="$2"; shift 2 ;;
    *)          echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# Nest services: name, workspace, entry point, default port
declare -A SERVICES=(
  [risk-service]="@arbibot/risk-service apps/risk-service/dist/main.js 3000"
  [opportunity-service]="@arbibot/opportunity-service apps/opportunity-service/dist/main.js 3010"
  [capital-service]="@arbibot/capital-service apps/capital-service/dist/main.js 3011"
  [execution-orchestrator]="@arbibot/execution-orchestrator apps/execution-orchestrator/dist/main.js 3012"
  [audit-service]="@arbibot/audit-service apps/audit-service/dist/main.js 3013"
  [canonical-market-service]="@arbibot/canonical-market-service apps/canonical-market-service/dist/main.js 3014"
  [market-intake-service]="@arbibot/market-intake-service apps/market-intake-service/dist/main.js 3015"
  [portfolio-service]="@arbibot/portfolio-service apps/portfolio-service/dist/main.js 3016"
  [reconciliation-service]="@arbibot/reconciliation-service apps/reconciliation-service/dist/main.js 3017"
  [paper-trading-service]="@arbibot/paper-trading-service apps/paper-trading-service/dist/main.js 3018"
  [config-service]="@arbibot/config-service apps/config-service/dist/main.js 3019"
  [hermes-gateway]="@arbibot/hermes-gateway apps/hermes-gateway/dist/main.js 3020"
)

echo "=== Building Arbibot 2 images (${REGISTRY}, tag=${TAG}) ==="
echo ""

FAILED=()

for svc in "${!SERVICES[@]}"; do
  read -r ws entry port <<< "${SERVICES[$svc]}"
  image="${REGISTRY}/arbibot-${svc}:${TAG}"
  echo ">>> Building ${image} (${ws}) ..."

  if ! docker build \
    -f infra/docker/Dockerfile.nest \
    --build-arg SERVICE="${ws}" \
    --build-arg ENTRY="${entry}" \
    --build-arg PORT="${port}" \
    -t "${image}" \
    --provenance=false \
    .; then
    echo "!!! FAILED: ${svc}"
    FAILED+=("${svc}")
    continue
  fi

  echo "<<< Built: ${image}"
  echo ""

  if [[ "${PUSH}" == "true" ]]; then
    echo "    Pushing ${image} ..."
    docker push "${image}" || echo "    PUSH FAILED: ${image}"
  fi
done

# Next.js web dashboard
WEB_IMAGE="${REGISTRY}/arbibot-web:${TAG}"
echo ">>> Building ${WEB_IMAGE} (Next.js) ..."

if ! docker build \
  -f infra/docker/Dockerfile.web \
  -t "${WEB_IMAGE}" \
  --provenance=false \
  .; then
  echo "!!! FAILED: web"
  FAILED+=("web")
else
  echo "<<< Built: ${WEB_IMAGE}"
  if [[ "${PUSH}" == "true" ]]; then
    echo "    Pushing ${WEB_IMAGE} ..."
    docker push "${WEB_IMAGE}" || echo "    PUSH FAILED: ${WEB_IMAGE}"
  fi
fi

echo ""
echo "=== Build summary ==="
echo "Total services: $((${#SERVICES[@]} + 1))"
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "Failed: ${FAILED[*]}"
  exit 1
else
  echo "All images built successfully."
fi