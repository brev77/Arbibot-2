/**
 * Configuration for Hermes MCP Server.
 * All settings come from environment variables.
 */
export interface HermesMcpConfig {
  /** Hermes Gateway base URL (default: http://localhost:3020) */
  gatewayUrl: string;
  /** API key for x-hermes-api-key header */
  apiKey: string;
}

const ENV_GATEWAY_URL = 'HERMES_GATEWAY_URL';
const ENV_API_KEY = 'HERMES_API_KEY';

export function loadConfig(): HermesMcpConfig {
  const gatewayUrl = process.env[ENV_GATEWAY_URL] ?? 'http://localhost:3020';
  const apiKey = process.env[ENV_API_KEY] ?? '';

  if (!apiKey) {
    console.error(
      `[hermes-mcp-server] WARNING: ${ENV_API_KEY} is not set — requests to gateway will fail`,
    );
  }

  return { gatewayUrl, apiKey };
}