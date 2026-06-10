import { HermesMcpConfig } from './config.js';

/**
 * HTTP client for Hermes Gateway.
 * Translates MCP tool calls into REST requests.
 */
export class HermesClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: HermesMcpConfig) {
    this.baseUrl = `${config.gatewayUrl}/hermes/v1`;
    this.headers = {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { 'x-hermes-api-key': config.apiKey } : {}),
    };
  }

  async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: this.headers,
    });
    return this.handleResponse<T>(res);
  }

  async post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return this.handleResponse<T>(res);
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown error');
      throw new Error(`Hermes gateway ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }
}