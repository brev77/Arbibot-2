#!/usr/bin/env bash
# Arbibot 2 — Internal mTLS Certificate Generator
#
# Generates a self-signed internal CA + per-service client/server certificates
# for mutual TLS between NestJS microservices on the `arbibot-backend` Docker network.
#
# Usage:
#   ./tools/generate-internal-certs.sh
#
# Output: infra/nginx/ssl/internal/ with:
#   - ca.crt, ca.key             (internal CA)
#   - <service>.crt, <service>.key (per-service leaf certs)
#   - truststore.pem             (CA bundle for verifying peers)
#
# Env:
#   INTERNAL_CERT_DAYS   (default 365)   — leaf certificate validity
#   INTERNAL_CA_DAYS     (default 3650)  — CA certificate validity
#   INTERNAL_CERT_RSA    (default 4096)  — RSA key size
#
# After generation, distribute via Docker secrets or mount as read-only volumes.
# For production, replace self-signed CA with your organization's PKI.

set -euo pipefail

OUT_DIR="${1:-infra/nginx/ssl/internal}"
CERT_DAYS="${INTERNAL_CERT_DAYS:-365}"
CA_DAYS="${INTERNAL_CA_DAYS:-3650}"
RSA_BITS="${INTERNAL_CERT_RSA:-4096}"

# Internal services that participate in mTLS mesh
SERVICES=(
  "risk-service"
  "opportunity-service"
  "capital-service"
  "execution-orchestrator"
  "audit-service"
  "canonical-market-service"
  "market-intake-service"
  "portfolio-service"
  "reconciliation-service"
  "paper-trading-service"
  "config-service"
  "hermes-gateway"
)

# Internal service DNS names (Docker Compose service names + localhost for dev)
ALT_NAMES_DNS="
DNS.1 = localhost
DNS.2 = arbibot-internal
"

for svc in "${SERVICES[@]}"; do
  ALT_NAMES_DNS+="DNS.$(( ${#SERVICES[@]} + 3 )) = ${svc}
"
done

echo "==> Creating output directory: ${OUT_DIR}"
mkdir -p "${OUT_DIR}"
chmod 700 "${OUT_DIR}"

# --- Internal CA ---
if [[ ! -f "${OUT_DIR}/ca.key" ]]; then
  echo "==> Generating internal CA key + certificate (${CA_DAYS} days)"
  openssl genrsa -out "${OUT_DIR}/ca.key" "${RSA_BITS}"
  openssl req -x509 -new -nodes \
    -key "${OUT_DIR}/ca.key" \
    -sha256 -days "${CA_DAYS}" \
    -subj "/C=US/ST=NA/L=NA/O=Arbibot2 Internal/CN=Arbibot2 Internal CA" \
    -out "${OUT_DIR}/ca.crt"
  chmod 600 "${OUT_DIR}/ca.key"
fi

# --- Per-service certificates ---
for svc in "${SERVICES[@]}"; do
  crt="${OUT_DIR}/${svc}.crt"
  key="${OUT_DIR}/${svc}.key"
  csr="${OUT_DIR}/${svc}.csr"

  if [[ -f "${crt}" && -f "${key}" ]]; then
    echo "==> Skipping ${svc} (already exists)"
    continue
  fi

  echo "==> Generating cert for ${svc}"
  openssl genrsa -out "${key}" "${RSA_BITS}"

  # Build per-service SAN list (service name + localhost)
  san="DNS:${svc},DNS:localhost,DNS:${svc}.arbibot-backend,DNS:arbibot-internal,IP:127.0.0.1"

  openssl req -new \
    -key "${key}" \
    -subj "/C=US/ST=NA/L=NA/O=Arbibot2 Internal/CN=${svc}" \
    -reqexts svc_ext \
    -config <(cat <<EOF
[req]
distinguished_name = req_dn
[req_dn]
[svc_ext]
subjectAltName = ${san}
extendedKeyUsage = serverAuth, clientAuth
keyUsage = digitalSignature, keyEncipherment
EOF
) -out "${csr}"

  openssl x509 -req \
    -in "${csr}" \
    -CA "${OUT_DIR}/ca.crt" \
    -CAkey "${OUT_DIR}/ca.key" \
    -CAcreateserial \
    -out "${crt}" \
    -days "${CERT_DAYS}" \
    -sha256 \
    -extfile <(cat <<EOF
subjectAltName = ${san}
extendedKeyUsage = serverAuth, clientAuth
keyUsage = digitalSignature, keyEncipherment
EOF
)

  chmod 644 "${crt}"
  chmod 600 "${key}"
  rm -f "${csr}"
done

# --- Truststore (CA bundle) ---
echo "==> Building truststore.pem"
cp "${OUT_DIR}/ca.crt" "${OUT_DIR}/truststore.pem"
chmod 644 "${OUT_DIR}/truststore.pem"

echo ""
echo "✅ Internal mTLS certificates generated in: ${OUT_DIR}"
echo ""
echo "Next steps:"
echo "  1. Mount ${OUT_DIR}/<service>.crt + ${OUT_DIR}/<service>.key + ${OUT_DIR}/ca.crt"
echo "     as read-only secrets in docker-compose.prod.yml"
echo "  2. Configure each service with SERVICE_TLS_CERT, SERVICE_TLS_KEY, SERVICE_TLS_CA"
echo "  3. For production, replace self-signed CA with organization PKI"