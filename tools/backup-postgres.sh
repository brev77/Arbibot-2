#!/usr/bin/env bash
# Arbibot 2 — PostgreSQL Backup & Restore Script
#
# Backup (default): creates a compressed pg_dump backup with timestamp.
# Restore:          restores a dump file into the configured DATABASE_URL.
#
# Usage:
#   bash tools/backup-postgres.sh                              # backup (defaults)
#   bash tools/backup-postgres.sh backup                       # explicit backup
#   bash tools/backup-postgres.sh restore <file>               # restore (interactive confirm)
#   bash tools/backup-postgres.sh restore <file> --force       # restore (no confirm)
#   DATABASE_URL=postgres://... bash tools/backup-postgres.sh  # override target DB
#
# Cron example (backup only):
#   0 2 * * * /opt/arbibot/tools/backup-postgres.sh backup >> /var/log/arbibot-backup.log 2>&1
#
# Restore notes:
#   - .sql.gz  → gunzip -c <file> | psql "$DATABASE_URL"
#   - .sql     → psql "$DATABASE_URL" -f <file>
#   - .dump / .custom (pg_dump -Fc) → pg_restore --clean --if-exists --no-owner
#   - The dump is restored AS-IS. pg_dump must be run with --clean --if-exists
#     (drop-before-create) to restore cleanly over an existing DB; otherwise
#     pre-existing objects cause errors. See "Backup before deploy" in
#     docs/deployment-guide.md.
#   - Destructive: restore OVERWRITES the target database. A confirm prompt is
#     shown unless --force is passed. Always run `npm run db:backup` first.
#
# Retention: keeps last 30 backups by default (DELETE_OLDER_THAN_DAYS=30).

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────
DATABASE_URL="${DATABASE_URL:-postgres://arbibot:arbibot@127.0.0.1:15432/arbibot}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${DELETE_OLDER_THAN_DAYS:-30}"

# ── Helpers ────────────────────────────────────────────────────
log()  { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
err()  { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: $*" >&2; }
usage() {
  cat <<EOF
Usage: bash tools/backup-postgres.sh [backup|restore <file> [--force]]

Commands:
  backup                Create a compressed pg_dump backup (default).
  restore <file>        Restore a dump into DATABASE_URL (interactive confirm).
                        <file> may be .sql.gz, .sql, or .dump/.custom (pg_restore).
  restore <file> --force  Restore without confirmation prompt.

Environment:
  DATABASE_URL            Target Postgres connection string.
  BACKUP_DIR              Backup output directory (default: ./backups).
  DELETE_OLDER_THAN_DAYS  Backup retention in days (default: 30).

Restore is DESTRUCTIVE — it overwrites the target database. Run
'npm run db:backup' before restoring in production.
EOF
}

do_backup() {
  local TIMESTAMP FILENAME FILEPATH
  TIMESTAMP=$(date -u +"%Y%m%d_%H%M%S")
  FILENAME="arbibot_${TIMESTAMP}.sql.gz"
  FILEPATH="${BACKUP_DIR}/${FILENAME}"

  mkdir -p "${BACKUP_DIR}"
  log "Starting backup → ${FILEPATH}"

  # --clean --if-exists: drop-before-create, so the dump is restorable over an
  # existing DB without manual cleanup. --no-owner/--no-privileges: portable.
  if pg_dump "${DATABASE_URL}" --no-owner --no-privileges --clean --if-exists | gzip > "${FILEPATH}.tmp"; then
    mv "${FILEPATH}.tmp" "${FILEPATH}"
    local SIZE
    SIZE=$(du -h "${FILEPATH}" | cut -f1)
    log "Backup complete: ${FILENAME} (${SIZE})"
  else
    rm -f "${FILEPATH}.tmp"
    err "pg_dump failed"
    exit 1
  fi

  # ── Retention cleanup ───────────────────────────────────────
  local DELETED
  DELETED=$(find "${BACKUP_DIR}" -name "arbibot_*.sql.gz" -mtime +${RETENTION_DAYS} -print -delete | wc -l)
  if [[ "${DELETED}" -gt 0 ]]; then
    log "Cleaned ${DELETED} backup(s) older than ${RETENTION_DAYS} days"
  fi

  # ── S3 upload (optional) ────────────────────────────────────
  # Uncomment and configure for off-site backup:
  # if command -v aws &>/dev/null; then
  #     S3_BUCKET="${S3_BACKUP_BUCKET:-s3://my-arbibot-backups}"
  #     aws s3 cp "${FILEPATH}" "${S3_BUCKET}/${FILENAME}" \
  #         --storage-class STANDARD_IA --only-show-errors
  #     log "Uploaded to ${S3_BUCKET}/${FILENAME}"
  # fi

  log "Done."
}

do_restore() {
  local FILEPATH="${1:-}"
  local FORCE=0
  if [[ "${2:-}" == "--force" ]]; then
    FORCE=1
  fi

  if [[ -z "${FILEPATH}" ]]; then
    err "restore requires a dump file argument"
    echo "" >&2
    usage >&2
    exit 1
  fi

  if [[ ! -f "${FILEPATH}" ]]; then
    err "dump file not found: ${FILEPATH}"
    exit 1
  fi

  # Detect dump format from extension.
  local EXT LOWER
  LOWER=$(echo "${FILEPATH}" | tr 'A-Z' 'a-z')
  if [[ "${LOWER}" == *.sql.gz ]]; then
    EXT="sql.gz"
  elif [[ "${LOWER}" == *.sql ]]; then
    EXT="sql"
  elif [[ "${LOWER}" == *.dump || "${LOWER}" == *.custom ]]; then
    EXT="custom"
  else
    err "unrecognized dump extension: ${FILEPATH} (expected .sql.gz, .sql, .dump, or .custom)"
    exit 1
  fi

  echo "==============================================================="
  echo "DESTRUCTIVE RESTORE"
  echo "  Target DATABASE_URL: ${DATABASE_URL}"
  echo "  Source dump:         ${FILEPATH} (${EXT})"
  echo "  This OVERWRITES the target database."
  echo "==============================================================="

  if [[ "${FORCE}" -ne 1 ]]; then
    echo ""
    read -r -p "Type RESTORE to confirm (anything else aborts): " CONFIRM
    if [[ "${CONFIRM}" != "RESTORE" ]]; then
      log "Aborted (no confirmation)."
      exit 1
    fi
  fi

  log "Starting restore → ${DATABASE_URL} from ${FILEPATH} (${EXT})"

  case "${EXT}" in
    sql.gz)
      if gunzip -c "${FILEPATH}" | psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -q; then
        log "Restore complete (gunzip | psql)."
      else
        err "gunzip | psql failed"
        exit 1
      fi
      ;;
    sql)
      if psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -q -f "${FILEPATH}"; then
        log "Restore complete (psql -f)."
      else
        err "psql -f failed"
        exit 1
      fi
      ;;
    custom)
      # pg_restore --clean --if-exists drops objects before recreating them.
      # --no-owner keeps the restore portable across roles.
      if pg_restore --dbname "${DATABASE_URL}" --clean --if-exists --no-owner --no-privileges -v "${FILEPATH}"; then
        log "Restore complete (pg_restore)."
      else
        err "pg_restore failed"
        exit 1
      fi
      ;;
  esac

  log "Done. Verify with: npm run db:verify-migrations:all"
}

# ── Dispatch ───────────────────────────────────────────────────
case "${1:-backup}" in
  backup)
    do_backup
    ;;
  restore)
    shift
    do_restore "$@"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    err "unknown command: ${1}"
    echo "" >&2
    usage >&2
    exit 1
    ;;
esac
