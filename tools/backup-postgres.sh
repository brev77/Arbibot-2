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
#
# ── Docker-host fallback (P8-5, 2026-08-02) ────────────────────────────────
# On a paper/standalone host where Postgres runs inside Docker and the system
# has no pg_dump/psql client installed (e.g. Aéza paper-deploy with pm2), the
# script auto-detects the absence of `pg_dump`/`psql` and falls back to
# `docker exec <PG_CONTAINER>` against the Postgres container. The container
# name is resolved from PG_CONTAINER env or auto-detected from the hostname in
# DATABASE_URL (host = postgres / 172.18.0.x / host.docker.internal → container
# name `infra-postgres-1` by convention; override via PG_CONTAINER). In prod
# (docker-compose.prod.yml) the backup sidecar (P7-2) has its own pg_dump, so
# this fallback is for the paper/standalone host only.

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────
DATABASE_URL="${DATABASE_URL:-postgres://arbibot:aribot@127.0.0.1:15432/arbibot}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${DELETE_OLDER_THAN_DAYS:-30}"
# Override the auto-detected Postgres container name (P8-5 docker fallback).
PG_CONTAINER="${PG_CONTAINER:-}"

# ── Helpers ────────────────────────────────────────────────────
log()  { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }
err()  { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR: $*" >&2; }

# Detect whether DATABASE_URL points at a dockerized Postgres by hostname.
# Returns the inferred container name (or empty) — caller overrides via PG_CONTAINER.
# Heuristics (P8-5): hostname in {postgres, db} OR 172.x.y.z (docker bridge) OR
# host.docker.internal → assume container `infra-postgres-1` (compose convention).
# 127.0.0.1 / localhost with port 5432 inside docker also qualifies if PG_CONTAINER set.
detect_pg_container() {
  if [[ -n "${PG_CONTAINER}" ]]; then echo "${PG_CONTAINER}"; return; fi
  local HOST PORT
  # Strip scheme, take user@host:port/db → host:port
  local WITHOUT_SCHEME="${DATABASE_URL#*://}"
  local AUTH_HOST="${WITHOUT_SCHEME#*@}"   # drop user:pass@
  HOST="${AUTH_HOST%%:*}"                  # take up to first ':' (or whole if no port)
  PORT="${AUTH_HOST#*:}"; PORT="${PORT%%/*}"
  case "${HOST}" in
    postgres|db) echo "infra-postgres-1"; return ;;
    172.*.*.*)   echo "infra-postgres-1"; return ;;   # docker bridge network
    host.docker.internal) echo "infra-postgres-1"; return ;;
  esac
  echo ""
}

# Wrap a Postgres client binary (pg_dump / psql / pg_restore) so that if the
# binary is missing on PATH, we retry inside the Postgres container via docker.
# Usage: run_pg_client pg_dump "<args...>"   (DATABASE_URL passed through)
# Echoes a single command string suitable for `eval`. This indirection lets the
# calling site keep its `| gzip` / `| psql` pipelines intact.
pg_client_cmd() {
  local BIN="$1"; shift
  if command -v "${BIN}" &>/dev/null; then
    printf '%q %s' "${BIN}" "${DATABASE_URL}"
    for a in "$@"; do printf ' %q' "$a"; done
    return
  fi
  # Fallback: no system client → use the Postgres container's bundled binary.
  local CNAME; CNAME="$(detect_pg_container)"
  if [[ -z "${CNAME}" ]]; then
    err "${BIN} not found on PATH and DATABASE_URL host doesn't look dockerized (host='$(echo "${DATABASE_URL}" | sed -E 's#.*@([^:/]+).*#\1#')')."
    err "Fix: either 'apt install postgresql-client-16' (or your PG major),"
    err "or set PG_CONTAINER=<docker-postgres-container-name> to use the container's bundled client."
    err "See docs/paper-deploy-aeza.md §«Полезные команды» (P8-5)."
    exit 127
  fi
  if ! command -v docker &>/dev/null; then
    err "${BIN} not found on PATH, docker not on PATH either — cannot fall back to container."
    exit 127
  fi
  log "P8-5: ${BIN} not on PATH → using 'docker exec ${CNAME} ${BIN}' (auto-detected container)"
  # The container sees Postgres on localhost (it IS the server). Replace the
  # external host in DATABASE_URL with 'localhost' so the container can connect.
  # For pg_dump/psql the URL just needs to resolve inside the container.
  # Simplest: connect via local socket by passing just the db name + user.
  # Parse user/db from DATABASE_URL for the container-internal connection.
  local WITHOUT_SCHEME="${DATABASE_URL#*://}"
  local USER="${WITHOUT_SCHEME%%@*}"; USER="${USER%%:*}"
  local AFTER_HOST="${WITHOUT_SCHEME#*@}"; AFTER_HOST="${AFTER_HOST#*/}"
  local DB="${AFTER_HOST%%\?*}"
  printf "docker exec %s %s --username %s --dbname %s" "${CNAME}" "${BIN}" "${USER}" "${DB}"
  for a in "$@"; do printf ' %q' "$a"; done
}

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
  PG_CONTAINER            (P8-5) Override the docker Postgres container name when
                          pg_dump/psql are not installed on the host; auto-detected
                          from DATABASE_URL hostname otherwise (docker bridge /
                          hostname 'postgres'/'db' / host.docker.internal).

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
  # P8-5: pg_dump may run inside the Postgres container if no system client.
  local PG_DUMP_CMD
  PG_DUMP_CMD="$(pg_client_cmd pg_dump --no-owner --no-privileges --clean --if-exists)"
  if eval "${PG_DUMP_CMD}" | gzip > "${FILEPATH}.tmp"; then
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
      # P8-5: psql may run inside the Postgres container if no system client.
      # We stream the dump into the container via stdin (`docker exec -i`).
      local PSQL_CMD
      PSQL_CMD="$(pg_client_cmd psql -v ON_ERROR_STOP=1 -q)"
      # docker exec variant from pg_client_cmd uses `docker exec <cname> psql ...`;
      # for piping stdin we need `-i` on docker exec. Patch the string if needed.
      if [[ "${PSQL_CMD}" == docker\ exec* ]]; then
        PSQL_CMD="${PSQL_CMD/docker exec /docker exec -i }"
      fi
      if gunzip -c "${FILEPATH}" | eval "${PSQL_CMD}"; then
        log "Restore complete (gunzip | psql)."
      else
        err "gunzip | psql failed"
        exit 1
      fi
      ;;
    sql)
      local PSQL_CMD2
      PSQL_CMD2="$(pg_client_cmd psql -v ON_ERROR_STOP=1 -q)"
      if [[ "${PSQL_CMD2}" == docker\ exec* ]]; then
        # Stream the file into the container via stdin instead of mounting it.
        if cat "${FILEPATH}" | { PSQL_CMD2="${PSQL_CMD2/docker exec /docker exec -i }"; eval "${PSQL_CMD2}"; }; then
          log "Restore complete (psql via docker exec -i)."
        else
          err "psql (docker exec) failed"
          exit 1
        fi
      else
        if psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -q -f "${FILEPATH}"; then
          log "Restore complete (psql -f)."
        else
          err "psql -f failed"
          exit 1
        fi
      fi
      ;;
    custom)
      # pg_restore --clean --if-exists drops objects before recreating them.
      # --no-owner keeps the restore portable across roles.
      # P8-5: when no system pg_restore, the dump file must be reachable from
      # the container — caller should place it in a mounted volume or copy it
      # in. We prefer the system client; the docker fallback for custom-format
      # restore requires the file path inside the container, which is fragile
      # and intentionally NOT auto-wired here. Document restoring custom dumps
      # via the system client or the backup sidecar (P7-2) instead.
      if pg_restore --dbname "${DATABASE_URL}" --clean --if-exists --no-owner --no-privileges -v "${FILEPATH}" 2>/dev/null; then
        log "Restore complete (pg_restore)."
      else
        err "pg_restore failed (custom-format restore needs a system pg_restore; the docker-container fallback is not supported for custom dumps — install postgresql-client or use the backup sidecar)"
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
