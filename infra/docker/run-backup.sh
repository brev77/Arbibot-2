#!/bin/sh
# Arbibot 2 — backup cron wrapper (P7-2).
# Invoked by crond on schedule, or manually via:
#   docker exec <backup-container> bash /usr/local/bin/run-backup.sh
#
# Calls the canonical backup-postgres.sh (same logic as `npm run db:backup`),
# then writes a status marker so the container HEALTHCHECK can detect a failing
# backup schedule (a cron job that silently stops backing up is the classic
# "backups were never tested" failure).

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
STATUS_FILE="${BACKUP_DIR}/.last-backup-status"

timestamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Run the canonical backup. backup-postgres.sh exits non-zero on pg_dump
# failure, which we capture (do NOT let set -e hide the status marker write).
if /usr/local/bin/backup-postgres.sh backup > /proc/1/fd/1 2>&1; then
  printf 'ok %s\n' "$(timestamp)" > "${STATUS_FILE}.tmp"
  mv "${STATUS_FILE}.tmp" "${STATUS_FILE}"
else
  RC=$?
  printf 'fail %s\n' "$(timestamp)" > "${STATUS_FILE}.tmp"
  mv "${STATUS_FILE}.tmp" "${STATUS_FILE}"
  echo "[backup] backup-postgres.sh exited ${RC} at $(timestamp)" >&2
  exit "${RC}"
fi
