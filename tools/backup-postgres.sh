#!/usr/bin/env bash
# Arbibot 2 — PostgreSQL Backup Script
#
# Creates a compressed pg_dump backup with timestamp.
# Designed for cron (e.g., daily at 02:00 UTC).
#
# Usage:
#   bash tools/backup-postgres.sh                          # defaults
#   DATABASE_URL=postgres://... BACKUP_DIR=/backups bash tools/backup-postgres.sh
#
# Cron example:
#   0 2 * * * /opt/arbibot/tools/backup-postgres.sh >> /var/log/arbibot-backup.log 2>&1
#
# Restore:
#   gunzip -c /backups/arbibot_20260521_020000.sql.gz | psql $DATABASE_URL
#
# Retention: keeps last 30 backups by default (DELETE_OLDER_THAN_DAYS=30).

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────
DATABASE_URL="${DATABASE_URL:-postgres://arbibot:arbibot@127.0.0.1:15432/arbibot}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${DELETE_OLDER_THAN_DAYS:-30}"
TIMESTAMP=$(date -u +"%Y%m%d_%H%M%S")
FILENAME="arbibot_${TIMESTAMP}.sql.gz"
FILEPATH="${BACKUP_DIR}/${FILENAME}"

# ── Pre-flight ─────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Starting backup → ${FILEPATH}"

# ── Dump ───────────────────────────────────────────────────────
if pg_dump "${DATABASE_URL}" --no-owner --no-privileges | gzip > "${FILEPATH}.tmp"; then
    mv "${FILEPATH}.tmp" "${FILEPATH}"
    SIZE=$(du -h "${FILEPATH}" | cut -f1)
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Backup complete: ${FILENAME} (${SIZE})"
else
    rm -f "${FILEPATH}.tmp"
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: pg_dump failed" >&2
    exit 1
fi

# ── Retention cleanup ──────────────────────────────────────────
DELETED=$(find "${BACKUP_DIR}" -name "arbibot_*.sql.gz" -mtime +${RETENTION_DAYS} -print -delete | wc -l)
if [[ "${DELETED}" -gt 0 ]]; then
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Cleaned ${DELETED} backup(s) older than ${RETENTION_DAYS} days"
fi

# ── S3 upload (optional) ──────────────────────────────────────
# Uncomment and configure for off-site backup:
# if command -v aws &>/dev/null; then
#     S3_BUCKET="${S3_BACKUP_BUCKET:-s3://my-arbibot-backups}"
#     aws s3 cp "${FILEPATH}" "${S3_BUCKET}/${FILENAME}" \
#         --storage-class STANDARD_IA \
#         --only-show-errors
#     echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Uploaded to ${S3_BUCKET}/${FILENAME}"
# fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Done."