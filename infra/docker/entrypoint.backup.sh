#!/bin/sh
# Arbibot 2 — backup sidecar entrypoint (P7-2).
# Renders a crontab from BACKUP_SCHEDULE and runs crond in the foreground.
#
# Env:
#   BACKUP_SCHEDULE       crontab(5) schedule (default: "0 2 * * *" = daily 02:00 UTC)
#   DATABASE_URL          target Postgres (required)
#   BACKUP_DIR            dump output (default /backups)
#   DELETE_OLDER_THAN_DAYS retention (default 30)
#   S3_BACKUP_BUCKET      optional off-site upload (enables aws s3 cp in the script)
#
# On start it runs ONE immediate backup so the volume is never empty on a fresh
# deploy (and so a misconfigured DATABASE_URL fails fast at startup, not at 02:00).

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is required (backup sidecar cannot connect to Postgres)" >&2
  exit 1
fi

SCHEDULE="${BACKUP_SCHEDULE:-0 2 * * *}"
echo "[backup] schedule: '${SCHEDULE}' (crontab(5) min hour dom mon dow, container TZ=UTC)"
echo "[backup] DATABASE_URL target set, BACKUP_DIR=${BACKUP_DIR:-/backups}, retention=${DELETE_OLDER_THAN_DAYS:-30}d"

# Immediate first backup — never ship an empty volume, fail fast on bad config.
echo "[backup] running initial backup on startup..."
if /usr/local/bin/run-backup.sh; then
  echo "[backup] initial backup ok"
else
  echo "[backup] WARNING: initial backup failed — crond will still start and retry on schedule. Check DATABASE_URL / Postgres health." >&2
fi

# Render the crontab. crond on alpine runs as root by default; we exec the
# wrapper which handles its own status marker. Log to stdout (crond -f -l 8).
CRONTAB_FILE="/etc/crontabs/arbibot"
mkdir -p "$(dirname "${CRONTAB_FILE}")"
# Field layout: schedule + command. crond requires a trailing newline.
echo "${SCHEDULE} /usr/local/bin/run-backup.sh" > "${CRONTAB_FILE}"
echo "" >> "${CRONTAB_FILE}"

echo "[backup] crontab installed; starting crond in foreground"
# -f foreground, -l 8 (verbose, includes job output). Logs to stdout/stderr.
exec crond -f -l 8
