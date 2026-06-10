import { z } from 'zod';
import { HermesClient } from '../hermes-client.js';

/** Opaque server type to avoid pulling MCP SDK generics into tool modules */
export type McpServerHandle = { tool: (...args: unknown[]) => unknown };

/** Shape type for tool schemas */
type ToolSchema = Record<string, z.ZodType>;

/** Tool result */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
}

/**
 * Type-safe wrapper around server.tool() that avoids TS2589
 * by keeping MCP SDK generics out of tool modules.
 */
export function registerTool(
  server: McpServerHandle,
  name: string,
  description: string,
  schema: ToolSchema,
  handler: (args: Record<string, unknown>) => Promise<ToolResult>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).tool(name, description, schema, handler);
}

export { HermesClient };