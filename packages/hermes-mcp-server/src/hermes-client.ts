import { HermesMcpConfig } from './config.js';

/**
 * HTTP client for Hermes Gateway.
 * Translates MCP tool calls into REST requests.
 */
export class HermesClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly operatorId: string | undefined;

  constructor(config: HermesMcpConfig) {
    this.baseUrl = `${config.gatewayUrl}/hermes/v1`;
    this.headers = {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { 'x-hermes-api-key': config.apiKey } : {}),
    };
    // config-service mutations require operatorId in the body; the agent is
    // already scoped to a single operator via the Telegram whitelist, so we
    // reuse that identity (Plan 6 — see docs/adr-hermes-config-management.md).
    this.operatorId =
      process.env.HERMES_OPERATOR_ID ?? process.env.OPERATOR_TELEGRAM_ID;
  }

  /** Operator identity for config mutations (HERMES_OPERATOR_ID | OPERATOR_TELEGRAM_ID). */
  getOperatorId(): string | undefined {
    return this.operatorId;
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

  /** PUT (Plan 6 — config-service `PUT /policy/configurations/:key`). */
  async put<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    return this.handleResponse<T>(res);
  }

  /** PATCH (Plan 6 — config-service `PATCH /policy/configurations/:key/status`). */
  async patch<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify(body),
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
