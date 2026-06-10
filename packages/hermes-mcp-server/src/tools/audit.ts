import { registerTool, type McpServerHandle, HermesClient } from './helper.js';

export function registerAuditTools(server: McpServerHandle, client: HermesClient): void {
  registerTool(server, 'get_approvals_queue', 'Get the pending approvals queue', {},
    async () => {
      const data = await client.get<unknown[]>('/approvals-queue');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );
}