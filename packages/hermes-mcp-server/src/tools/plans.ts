import { z } from 'zod';
import { registerTool, type McpServerHandle, HermesClient } from './helper.js';

export function registerPlanTools(server: McpServerHandle, client: HermesClient): void {
  registerTool(server, 'list_plans', 'List execution plans', {},
    async () => {
      const data = await client.get<unknown[]>('/plans');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  registerTool(server, 'get_plan', 'Get execution plan details', {
      planId: z.string().describe('Plan UUID'),
    },
    async (args) => {
      const data = await client.get<unknown>(`/plans/${args.planId as string}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  registerTool(server, 'arm_plan', 'Arm an execution plan for trading (mutation)', {
      planId: z.string().describe('Plan UUID to arm'),
    },
    async (args) => {
      const data = await client.post<unknown>(`/plans/${args.planId as string}/arm`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  registerTool(server, 'execute_plan', 'Execute an armed plan (mutation)', {
      planId: z.string().describe('Plan UUID to execute'),
    },
    async (args) => {
      const data = await client.post<unknown>(`/plans/${args.planId as string}/execute`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );
}