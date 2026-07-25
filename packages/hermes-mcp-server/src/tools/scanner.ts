import { z } from 'zod';
import { registerTool, type McpServerHandle, HermesClient } from './helper.js';

/**
 * Scanner-service MCP tools (S4-4-HERMES).
 *
 * Exposes read-only scanner views to the Hermes agent so an operator can ask in Telegram
 * "что нашёл сканер?" and get a human-readable summary. The gateway proxies these to
 * scanner-service `/scanner/*`; mutations (run / refresh-config / re-publish) stay on the
 * operator UI BFF.
 */
export function registerScannerTools(
  server: McpServerHandle,
  client: HermesClient,
): void {
  registerTool(
    server,
    'list_scanner_findings',
    'List latest scanner findings (cross-DEX spreads detected by scanner-service)',
    {
      instanceId: z
        .string()
        .optional()
        .describe('Filter by scanner instance id (e.g. "arb-2venue-1")'),
      publishStatus: z
        .string()
        .optional()
        .describe('Filter by publish status: "pending" | "published" | "failed"'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('Max findings to return (default 20)'),
    },
    async (args) => {
      const params = new URLSearchParams();
      const instanceId = args['instanceId'];
      if (typeof instanceId === 'string' && instanceId.length > 0) {
        params.set('instanceId', instanceId);
      }
      const publishStatus = args['publishStatus'];
      if (typeof publishStatus === 'string' && publishStatus.length > 0) {
        params.set('publishStatus', publishStatus);
      }
      const limit = typeof args['limit'] === 'number' ? args['limit'] : 20;
      params.set('limit', String(limit));
      const qs = `?${params.toString()}`;
      const data = await client.get<unknown>(`/scanner/findings${qs}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  registerTool(
    server,
    'get_scanner_status',
    'Get scanner-service worker runtime status (scheduled / running instance ids)',
    {},
    async () => {
      const data = await client.get<unknown>('/scanner/status');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );
}
