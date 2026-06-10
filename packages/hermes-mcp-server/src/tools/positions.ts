import { z } from 'zod';
import { registerTool, type McpServerHandle, HermesClient } from './helper.js';

export function registerPositionTools(server: McpServerHandle, client: HermesClient): void {
  registerTool(server, 'list_positions', 'List portfolio positions', {},
    async () => {
      const data = await client.get<unknown[]>('/positions');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  registerTool(server, 'close_position', 'Close a portfolio position (mutation — requires operator approval via gateway)', {
      positionId: z.string().describe('Position UUID to close'),
    },
    async (args) => {
      const data = await client.post<unknown>(`/positions/${args.positionId as string}/close`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );
}