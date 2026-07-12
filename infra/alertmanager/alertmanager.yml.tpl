# Arbibot 2 — Alertmanager Configuration (PRODUCTION TEMPLATE)
#
# This file is rendered by infra/docker/entrypoint.alertmanager.sh via envsubst
# before alertmanager starts. Secrets (SLACK_WEBHOOK_URL, PAGERDUTY_ROUTING_KEY)
# are injected from environment variables — they MUST NOT be committed.
#
# Source-of-truth env vars (see .env.production.example):
#   - SLACK_WEBHOOK_URL          — Slack incoming webhook for #arbibot-critical
#   - PAGERDUTY_ROUTING_KEY       — PagerDuty Events API v2 routing key
#   - ALERTMANAGER_SLACK_CHANNEL  — target channel (default: #arbibot-critical)
#
# Validation (rendered config):
#   docker run --rm -v $(pwd)/infra/alertmanager/alertmanager.yml:/etc/alertmanager/config.yml \
#     prom/alertmanager:latest amtool check-config /etc/alertmanager/config.yml
#
# Reload without restart (requires --web.enable-lifecycle):
#   curl -X POST http://localhost:9093/-/reload

global:
  resolve_timeout: 5m

# ── Templates ──────────────────────────────────────────────────
templates:
  - '/etc/alertmanager/templates/*.tmpl'

# ── Routes ──────────────────────────────────────────────────────
route:
  receiver: "default"
  group_by: ["alertname", "severity", "job"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  # Mirror every alert to the Arbibot incidents pipeline (Drill #1 gap #1).
  # `continue: true` ensures severity/specialized receivers still fire too.
  routes:
    - receiver: "arbibot-incidents"
      continue: true

    # Critical alerts → Slack + PagerDuty (immediate page)
    - match:
        severity: critical
      receiver: "critical"
      group_wait: 15s
      repeat_interval: 1h
      continue: true

    # Warning alerts → Slack only (batched)
    - match:
        severity: warning
      receiver: "warnings"
      group_wait: 5m
      repeat_interval: 4h

    # Paper trading specific
    - match:
        alertname: PaperDriftBpsSustainedHigh
      receiver: "paper-trading"
      repeat_interval: 30m

    # DEX alerts
    - match_re:
        alertname: DEX.*
      receiver: "dex"
      repeat_interval: 15m

    # Infrastructure alerts
    - match_re:
        alertname: (ServiceDown|HighMemoryUsage|HighErrorRate)
      receiver: "infrastructure"
      repeat_interval: 30m

# ── Inhibition rules ────────────────────────────────────────────
# Suppress warning if critical alert is already firing for same job
inhibit_rules:
  - source_match:
      severity: critical
    target_match:
      severity: warning
    equal: ["alertname", "job"]

# ── Receivers ───────────────────────────────────────────────────
receivers:
  # Arbibot incidents pipeline: forwards to reconciliation-service (port 3017),
  # the single-writer for `alertmanager_incidents` (Drill #1 gap #1).
  # Operator Web `/incidents` merges these with reconciliation mismatches.
  # Env: ALERT_WEBHOOK_TOKEN optional Bearer secret on the receiver side.
  - name: "arbibot-incidents"
    webhook_configs:
      - url: "http://reconciliation-service:3017/alerts/webhook"
        send_resolved: true
        max_alerts: 0

  # Default: Slack #arbibot-on-call (non-critical / unrouted alerts).
  # If SLACK_WEBHOOK_URL is empty, this receiver is inert (envsubst renders
  # an empty api_url, which Alertmanager rejects at parse time — so the
  # entrypoint falls back to a no-op webhook when the secret is absent).
  - name: "default"
    slack_configs:
      - channel: "${ALERTMANAGER_SLACK_CHANNEL}"
        api_url: "${SLACK_WEBHOOK_URL}"
        title: "[{{ .Status | toUpper }}] {{ .CommonLabels.alertname }}"
        text: "{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}{{ end }}"
        send_resolved: true

  # Critical: page on-call via PagerDuty + mirror to Slack #arbibot-critical.
  - name: "critical"
    pagerduty_configs:
      - routing_key: "${PAGERDUTY_ROUTING_KEY}"
        severity: critical
        description: "[CRITICAL] {{ .GroupLabels.alertname }} — {{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}{{ end }}"
        send_resolved: true
    slack_configs:
      - channel: "${ALERTMANAGER_SLACK_CHANNEL}"
        api_url: "${SLACK_WEBHOOK_URL}"
        title: "🔴 {{ .GroupLabels.alertname }}"
        text: "{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}{{ end }}"
        send_resolved: true

  # Warnings: Slack only (no PagerDuty pages for non-critical).
  - name: "warnings"
    slack_configs:
      - channel: "${ALERTMANAGER_SLACK_CHANNEL}"
        api_url: "${SLACK_WEBHOOK_URL}"
        title: "⚠️ {{ .GroupLabels.alertname }}"
        text: "{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}{{ end }}"
        send_resolved: true

  # Paper trading alerts: Slack #arbibot-paper (use main channel if unset).
  - name: "paper-trading"
    slack_configs:
      - channel: "${ALERTMANAGER_SLACK_CHANNEL}"
        api_url: "${SLACK_WEBHOOK_URL}"
        title: "📊 {{ .GroupLabels.alertname }}"
        text: "{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}{{ end }}"
        send_resolved: true

  # DEX alerts: Slack (capital-safety relevant).
  - name: "dex"
    slack_configs:
      - channel: "${ALERTMANAGER_SLACK_CHANNEL}"
        api_url: "${SLACK_WEBHOOK_URL}"
        title: "🔗 {{ .GroupLabels.alertname }}"
        text: "{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}{{ end }}"
        send_resolved: true

  # Infrastructure: Slack + PagerDuty (ServiceDown is page-worthy).
  - name: "infrastructure"
    pagerduty_configs:
      - routing_key: "${PAGERDUTY_ROUTING_KEY}"
        severity: critical
        description: "[INFRA] {{ .GroupLabels.alertname }} — {{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}{{ end }}"
        send_resolved: true
    slack_configs:
      - channel: "${ALERTMANAGER_SLACK_CHANNEL}"
        api_url: "${SLACK_WEBHOOK_URL}"
        title: "🏗️ {{ .GroupLabels.alertname }}"
        text: "{{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}{{ end }}"
        send_resolved: true
