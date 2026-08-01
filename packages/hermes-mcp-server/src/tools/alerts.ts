import { z } from 'zod';
import { registerTool, type McpServerHandle, HermesClient } from './helper.js';

/**
 * Alertmanager incidents MCP tools (P7-7 — Hermes alert pipeline).
 *
 * Exposes Prometheus/Alertmanager alerts (forwarded to reconciliation-service
 * `/alerts/webhook` → `alertmanager_incidents` table) to the Hermes agent so
 * the `alert_watch` cron can forward critical alerts (disk, ServiceDown,
 * error-rate) to the operator's Telegram.
 *
 * This is intentionally SEPARATE from `incidents.ts`: those read reconciliation
 * MISMATCHES (`reconciliation_mismatches`); these read Prometheus ALERTS
 * (`alertmanager_incidents`). Before P7-7 the agent could not see Prometheus
 * alerts at all — the structural gap this tool closes.
 *
 * Read-only — status transitions on alerts stay on the operator UI BFF.
 */
export function registerAlertTools(
  server: McpServerHandle,
  client: HermesClient,
): void {
  registerTool(
    server,
    'list_alertmanager_incidents',
    'List Prometheus/Alertmanager alerts (disk, ServiceDown, error-rate) forwarded to reconciliation-service. Distinct from reconciliation mismatches.',
    {
      status: z
        .string()
        .optional()
        .describe(
          'Filter by alert incident status: "open" | "firing" | "investigating" | "resolved". Omit for all (newest-first).',
        ),
    },
    async (args) => {
      const status = args['status'];
      const qs =
        typeof status === 'string' && status.length > 0
          ? `?status=${encodeURIComponent(status)}`
          : '';
      const data = await client.get<unknown>(`/alerts${qs}`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
      };
    },
  );
}
