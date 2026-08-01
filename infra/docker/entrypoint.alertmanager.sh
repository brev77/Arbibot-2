#!/bin/sh
# Arbibot 2 — Alertmanager entrypoint (PRODUCTION)
#
# Renders infra/alertmanager/alertmanager.yml.tpl into a final config via
# envsubst, substituting the PagerDuty routing key from the environment, then
# starts alertmanager. Used only in infra/docker-compose.prod.yml.
#
# Env vars consumed:
#   PAGERDUTY_ROUTING_KEY  — PagerDuty Events API v2 routing key (may be empty)
#
# Notification channels (decided P7-3, 2026-08-01):
#   - Hermes → Telegram  — primary channel. Every alert is mirrored to the
#                          arbibot-incidents receiver (reconciliation-service),
#                          which Hermes Agent (P7-7) pulls from via hermes-gateway
#                          and forwards to Telegram. Works even with no paging
#                          secrets at all.
#   - PagerDuty           — critical-alert paging (ServiceDown, DiskSpaceCritical).
#                          Optional; if the routing key is empty, the PagerDuty
#                          receivers render with an empty routing_key and become
#                          inert (alertmanager tolerates this — it simply drops
#                          the page), while the arbibot-incidents + Hermes/Telegram
#                          path stays fully functional.
#   - Slack               — REMOVED (P7-3). Slack receivers are gone from the
#                          template; empty api_url no longer risks a parse crash.
#
# Fail-safe: an empty PAGERDUTY_ROUTING_KEY is non-fatal. The template has no
# slack_configs anymore (those were the parse-risk when empty), and an empty
# pagerduty routing_key is accepted by alertmanager (the page is dropped). So we
# always render the template and just log a warning when paging is unconfigured.
#
# Secrets are NEVER logged.

set -e

TPL_PATH="/etc/alertmanager/alertmanager.yml.tpl"
OUT_PATH="/etc/alertmanager/alertmanager.yml"

PAGER_KEY="${PAGERDUTY_ROUTING_KEY:-}"

# Substitute env vars into the template. Only PAGERDUTY_ROUTING_KEY is expanded
# now (Slack vars were removed in P7-3); alertmanager Go-template syntax
# (${{ . }}) is preserved because envsubst only replaces ${VAR} / $VAR forms.
export PAGERDUTY_ROUTING_KEY="$PAGER_KEY"
envsubst < "$TPL_PATH" > "$OUT_PATH"

if [ -z "$PAGER_KEY" ]; then
  echo "===============================================================" >&2
  echo "WARNING: PAGERDUTY_ROUTING_KEY not configured." >&2
  echo "  Critical alerts will NOT be paged via PagerDuty." >&2
  echo "  They still flow to /incidents + Hermes/Telegram via the" >&2
  echo "  arbibot-incidents receiver. Set PAGERDUTY_ROUTING_KEY in .env" >&2
  echo "  and restart alertmanager to enable PagerDuty paging." >&2
  echo "===============================================================" >&2
  echo "Alertmanager config rendered (PagerDuty=unset, Hermes/Telegram active)." >&2
else
  echo "Alertmanager config rendered (PagerDuty=set)." >&2
fi

# Hand off to the alertmanager binary (passed as CMD / args).
exec "$@"
