# Arbibot 2 — Alertmanager Configuration (PRODUCTION TEMPLATE)
#
# This file is rendered by infra/docker/entrypoint.alertmanager.sh via envsubst
# before alertmanager starts. Secrets (PAGERDUTY_ROUTING_KEY) are injected from
# environment variables — they MUST NOT be committed.
#
# Notification channels (decided P7-3, 2026-08-01):
#   - Hermes → Telegram  — the operator's primary channel. Prometheus alerts
#                          land in `alertmanager_incidents` via the
#                          arbibot-incidents receiver below; Hermes Agent pulls
#                          them (cron `alert_watch`, P7-7) and forwards to
#                          Telegram. Pull model — no Alertmanager→Hermes webhook.
#   - PagerDuty           — retained for severity=critical alerts (ServiceDown,
#                          DiskSpaceCritical). Configure PAGERDUTY_ROUTING_KEY.
#   - Slack               — REMOVED (operator does not use Slack).
#
# Source-of-truth env vars (see .env.example):
#   - PAGERDUTY_ROUTING_KEY  — PagerDuty Events API v2 routing key (critical only)
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
  # This is ALSO the source for the Hermes → Telegram pipeline (P7-7): Hermes
  # Agent pulls from `alertmanager_incidents` via hermes-gateway, so every alert
  # must land here regardless of severity.
  routes:
    - receiver: "arbibot-incidents"
      continue: true

    # Critical alerts → PagerDuty (immediate page). Also mirrored to Telegram
    # via arbibot-incidents above (Hermes pulls it).
    - match:
        severity: critical
      receiver: "critical"
      group_wait: 15s
      repeat_interval: 1h
      continue: true

    # Warning alerts → no external page; surface in /incidents + Hermes/Telegram
    # via arbibot-incidents. Receiver is a no-op ( PagerDuty is critical-only).
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

    # Infrastructure alerts (incl. disk — P7-3). DiskSpaceCritical is
    # severity=critical and is caught by the critical route above (PagerDuty);
    # DiskSpaceLow (warning) lands here and in /incidents + Hermes/Telegram.
    - match_re:
        alertname: (ServiceDown|HighMemoryUsage|HighErrorRate|DiskSpaceLow)
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
  # Hermes Agent (P7-7) reads these via hermes-gateway GET /hermes/v1/alerts
  # and forwards to Telegram.
  # Env: ALERT_WEBHOOK_TOKEN optional Bearer secret on the receiver side.
  - name: "arbibot-incidents"
    webhook_configs:
      - url: "http://reconciliation-service:3017/alerts/webhook"
        send_resolved: true
        max_alerts: 0

  # Default: no-op (unrouted / non-critical alerts). Slack was removed (P7-3);
  # these are still mirrored to /incidents + Hermes/Telegram via arbibot-incidents.
  - name: "default"
    webhook_configs:
      - url: "http://127.0.0.1:5001/alerts"
        send_resolved: true

  # Critical: page on-call via PagerDuty. Also delivered to Telegram through
  # the arbibot-incidents mirror → Hermes pull pipeline (P7-7).
  - name: "critical"
    pagerduty_configs:
      - routing_key: "${PAGERDUTY_ROUTING_KEY}"
        severity: critical
        description: "[CRITICAL] {{ .GroupLabels.alertname }} — {{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}{{ end }}"
        send_resolved: true

  # Warnings: no PagerDuty page. Surfaced in /incidents + Hermes/Telegram.
  - name: "warnings"
    webhook_configs:
      - url: "http://127.0.0.1:5001/alerts/warnings"
        send_resolved: true

  # Paper trading alerts: /incidents + Hermes/Telegram.
  - name: "paper-trading"
    webhook_configs:
      - url: "http://127.0.0.1:5001/alerts/paper"
        send_resolved: true

  # DEX alerts (capital-safety relevant): /incidents + Hermes/Telegram.
  - name: "dex"
    webhook_configs:
      - url: "http://127.0.0.1:5001/alerts/dex"
        send_resolved: true

  # Infrastructure: PagerDuty for page-worthy infra alerts (ServiceDown etc.).
  # DiskSpaceCritical (severity=critical) is caught by the critical route above.
  # DiskSpaceLow (warning) lands here + /incidents + Hermes/Telegram.
  - name: "infrastructure"
    pagerduty_configs:
      - routing_key: "${PAGERDUTY_ROUTING_KEY}"
        severity: critical
        description: "[INFRA] {{ .GroupLabels.alertname }} — {{ range .Alerts }}{{ .Annotations.summary }}\n{{ .Annotations.description }}{{ end }}"
        send_resolved: true
