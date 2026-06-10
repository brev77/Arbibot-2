import { registerTool, type McpServerHandle, HermesClient } from './helper.js';

export function registerSafeModeTools(server: McpServerHandle, client: HermesClient): void {
  registerTool(server, 'get_safe_mode_status', 'Get current safe mode status', {},
    async () => {
      const data = await client.get<unknown>('/safe-mode/status');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  registerTool(server, 'enable_safe_mode', 'Enable safe mode (mutation — blocks all trading)', {},
    async () => {
      const data = await client.post<unknown>('/safe-mode/enable');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  registerTool(server, 'disable_safe_mode', 'Disable safe mode (mutation — resumes trading)', {},
    async () => {
      const data = await client.post<unknown>('/safe-mode/disable');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );
}