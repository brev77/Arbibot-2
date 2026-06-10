#!/usr/bin/env node
/**
 * Hermes MCP Server — entry point.
 * Translates MCP tool calls into Hermes Gateway HTTP requests.
 *
 * Transport: stdio (launched by AI agent as a subprocess).
 *
 * Env:
 *   HERMES_GATEWAY_URL — gateway base URL (default http://localhost:3020)
 *   HERMES_API_KEY     — API key for x-hermes-api-key header
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig } from './config.js';
import { HermesClient } from './hermes-client.js';
import { registerTools } from './tools/index.js';
import type { McpServerHandle } from './tools/helper.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new HermesClient(config);

  const server = new McpServer({
    name: 'hermes-mcp-server',
    version: '0.1.0',
  });

  registerTools(server as unknown as McpServerHandle, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('[hermes-mcp-server] Connected via stdio, gateway:', config.gatewayUrl);
}

main().catch((err: unknown) => {
  console.error('[hermes-mcp-server] Fatal:', err);
  process.exit(1);
});