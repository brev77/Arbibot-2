import { registerTool, type McpServerHandle, HermesClient } from './helper.js';

export function registerDashboardTools(server: McpServerHandle, client: HermesClient): void {
  registerTool(server, 'get_dashboard_summary', 'Get dashboard summary (incidents, capital, positions overview)', {},
    async () => {
      const data = await client.get<unknown>('/dashboard/summary');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );
}