#!/bin/sh
# PgBouncer entrypoint — generates userlist.txt from POSTGRES_PASSWORD env var
#
# This script creates the authentication file dynamically so we don't
# hardcode credentials in a file committed to git.
#
# Usage: POSTGRES_PASSWORD=secret bash entrypoint.sh

set -e

USER="${POSTGRES_USER:-arbibot}"
PASS="${POSTGRES_PASSWORD:-arbibot}"

# Write userlist.txt with the password from environment
echo "\"${USER}\" \"${PASS}\"" > /etc/pgbouncer/userlist.txt

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] PgBouncer userlist generated for user: ${USER}"

# Start PgBouncer
exec pgbouncer /etc/pgbouncer/pgbouncer.ini