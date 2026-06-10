import { z } from 'zod';
import { registerTool, type McpServerHandle, HermesClient } from './helper.js';

export function registerIncidentTools(server: McpServerHandle, client: HermesClient): void {
  registerTool(server, 'list_incidents', 'List reconciliation incidents', {
      limit: z.number().optional().describe('Max number of incidents to return'),
    },
    async (args) => {
      const limit = args.limit as number | undefined;
      const query = limit ? `?limit=${limit}` : '';
      const data = await client.get<unknown[]>(`/incidents${query}`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  registerTool(server, 'resolve_incident', 'Resolve a reconciliation incident (mutation)', {
      incidentId: z.string().describe('Incident UUID to resolve'),
    },
    async (args) => {
      const data = await client.post<unknown>(`/incidents/${args.incidentId as string}/resolve`);
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );

  registerTool(server, 'list_incident_briefs', 'List brief summaries of incidents', {},
    async () => {
      const data = await client.get<unknown[]>('/incident-briefs');
      return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    },
  );
}