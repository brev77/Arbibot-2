#!/bin/sh
# Arbibot 2 — Alertmanager entrypoint (PRODUCTION)
#
# Renders infra/alertmanager/alertmanager.yml.tpl into a final config via
# envsubst, substituting paging secrets from environment variables, then starts
# alertmanager. Used only in infra/docker-compose.prod.yml.
#
# Env vars consumed:
#   SLACK_WEBHOOK_URL           — Slack incoming webhook URL (may be empty)
#   PAGERDUTY_ROUTING_KEY        — PagerDuty Events API v2 routing key (may be empty)
#   ALERTMANAGER_SLACK_CHANNEL   — target Slack channel (default: #arbibot-critical)
#
# Fail-safe: if BOTH paging secrets are empty, the rendered config would contain
# invalid empty api_url/routing_key fields. In that case we fall back to a
# no-op config that keeps ONLY the arbibot-incidents receiver (alerts still
# appear in the /incidents UI), and log a loud warning — the operator must set
# the secrets to receive pages. This prevents alertmanager from crashing on a
# misconfigured deploy while keeping the incidents pipeline alive.
#
# Secrets are NEVER logged.

set -e

TPL_PATH="/etc/alertmanager/alertmanager.yml.tpl"
OUT_PATH="/etc/alertmanager/alertmanager.yml"
FALLBACK_PATH="/etc/alertmanager/alertmanager.dev.yml"

SLACK_URL="${SLACK_WEBHOOK_URL:-}"
PAGER_KEY="${PAGERDUTY_ROUTING_KEY:-}"
SLACK_CHANNEL="${ALERTMANAGER_SLACK_CHANNEL:-#arbibot-critical}"

if [ -z "$SLACK_URL" ] && [ -z "$PAGER_KEY" ]; then
  echo "===============================================================" >&2
  echo "WARNING: paging secrets not configured." >&2
  echo "  SLACK_WEBHOOK_URL and PAGERDUTY_ROUTING_KEY are both empty." >&2
  echo "  Alertmanager will run with the incidents-pipeline-only config." >&2
  echo "  CRITICAL alerts will NOT be paged. Set the secrets in .env and" >&2
  echo "  restart the alertmanager service." >&2
  echo "===============================================================" >&2
  if [ -f "$FALLBACK_PATH" ]; then
    cp "$FALLBACK_PATH" "$OUT_PATH"
  else
    # Inline minimal config: incidents pipeline only.
    cat > "$OUT_PATH" <<EOF
global:
  resolve_timeout: 5m
route:
  receiver: "arbibot-incidents"
  group_by: ["alertname", "severity", "job"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
receivers:
  - name: "arbibot-incidents"
    webhook_configs:
      - url: "http://reconciliation-service:3017/alerts/webhook"
        send_resolved: true
        max_alerts: 0
EOF
  fi
else
  # Substitute env vars into the template. Only the paging-related variables
  # are expanded; alertmanager template syntax (${{ . }}) is preserved because
  # envsubst only replaces ${VAR} / $VAR forms, not Go-template braces.
  export SLACK_WEBHOOK_URL="$SLACK_URL"
  export PAGERDUTY_ROUTING_KEY="$PAGER_KEY"
  export ALERTMANAGER_SLACK_CHANNEL="$SLACK_CHANNEL"
  envsubst < "$TPL_PATH" > "$OUT_PATH"
  echo "Alertmanager config rendered with paging receivers (Slack=${SLACK_URL:+set}, PagerDuty=${PAGER_KEY:+set})." >&2
fi

# Hand off to the alertmanager binary (passed as CMD / args).
exec "$@"
