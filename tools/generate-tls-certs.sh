#!/usr/bin/env bash
# Arbibot 2 — TLS Certificate Generation Script
#
# Generates self-signed TLS certificates for development/testing.
# For production, use Let's Encrypt, cert-manager, or your CA.
#
# Usage:
#   bash tools/generate-tls-certs.sh
#   DOMAIN=operator.example.com bash tools/generate-tls-certs.sh
#   DAYS=3650 bash tools/generate-tls-certs.sh
#
# Output:
#   infra/nginx/ssl/privkey.pem    — private key
#   infra/nginx/ssl/fullchain.pem  — certificate chain

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────
DOMAIN="${DOMAIN:-localhost}"
DAYS="${DAYS:-365}"
SSL_DIR="infra/nginx/ssl"
KEY_FILE="${SSL_DIR}/privkey.pem"
CERT_FILE="${SSL_DIR}/fullchain.pem"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "╔══════════════════════════════════════════════════╗"
echo "║  Arbibot 2 — TLS Certificate Generator          ║"
echo "║  Domain: ${DOMAIN}"
echo "║  Valid for: ${DAYS} days"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Pre-flight checks ─────────────────────────────────────────
if ! command -v openssl &>/dev/null; then
  echo -e "${RED}ERROR: openssl not found. Install openssl first.${NC}"
  exit 1
fi

# ── Create SSL directory ───────────────────────────────────────
mkdir -p "${SSL_DIR}"

# ── Check existing certs ───────────────────────────────────────
if [[ -f "${KEY_FILE}" && -f "${CERT_FILE}" ]]; then
  EXPIRY=$(openssl x509 -enddate -noout -in "${CERT_FILE}" 2>/dev/null | cut -d= -f2 || echo "unknown")
  echo -e "${YELLOW}WARNING: Existing certificates found (expires: ${EXPIRY})${NC}"
  read -rp "Overwrite? [y/N] " -n 1 -r
  echo
  if [[ ! "${REPLY}" =~ ^[Yy]$ ]]; then
    echo "Aborted. Existing certificates kept."
    exit 0
  fi
fi

# ── Generate certificates ──────────────────────────────────────
echo ""
echo "Generating self-signed TLS certificate..."

# Create SAN config for multiple domains
SAN_CONFIG=$(mktemp)
cat > "${SAN_CONFIG}" <<EOF
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = v3_req

[dn]
CN = ${DOMAIN}
O = Arbibot 2
C = US

[v3_req]
subjectAltName = @alt_names
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth

[alt_names]
DNS.1 = ${DOMAIN}
DNS.2 = *.${DOMAIN}
DNS.3 = localhost
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

openssl req -x509 -nodes \
  -days "${DAYS}" \
  -newkey rsa:2048 \
  -keyout "${KEY_FILE}" \
  -out "${CERT_FILE}" \
  -config "${SAN_CONFIG}" \
  2>/dev/null

rm -f "${SAN_CONFIG}"

# ── Verify ─────────────────────────────────────────────────────
if [[ -f "${KEY_FILE}" && -f "${CERT_FILE}" ]]; then
  CERT_INFO=$(openssl x509 -noout -subject -dates -in "${CERT_FILE}" 2>/dev/null)
  
  echo ""
  echo -e "${GREEN}✓${NC} Certificate generated successfully"
  echo ""
  echo "Files:"
  echo "  Key:  ${KEY_FILE}"
  echo "  Cert: ${CERT_FILE}"
  echo ""
  echo "Certificate details:"
  echo "${CERT_INFO}" | sed 's/^/  /'
  echo ""
  echo -e "${YELLOW}NOTE: Self-signed certificates will show browser warnings.${NC}"
  echo -e "${YELLOW}For production, use Let's Encrypt or your organization's CA.${NC}"
  echo ""
  echo "Next steps:"
  echo "  1. docker compose -f infra/docker-compose.prod.yml up -d"
  echo "  2. Access https://${DOMAIN}/ (accept browser warning for self-signed)"
else
  echo -e "${RED}ERROR: Failed to generate certificates${NC}"
  exit 1
fi