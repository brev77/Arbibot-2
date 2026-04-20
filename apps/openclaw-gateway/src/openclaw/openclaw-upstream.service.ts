import { Injectable, Logger } from '@nestjs/common';

export type UpstreamJsonResult = {
  status: number;
  json: unknown;
};

@Injectable()
export class OpenclawUpstreamService {
  private readonly log = new Logger(OpenclawUpstreamService.name);

  /**
   * GET JSON from an upstream service, forwarding correlation id when present.
   */
  async getJson(
    url: string,
    correlationId?: string,
  ): Promise<UpstreamJsonResult> {
    const headers: Record<string, string> = {};
    if (correlationId !== undefined && correlationId.length > 0) {
      headers['x-correlation-id'] = correlationId;
    }

    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', headers });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn(`Upstream fetch failed: ${url} — ${message}`);
      throw err;
    }

    const text = await res.text();
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = { raw: text };
      }
    }

    return { status: res.status, json };
  }

  /**
   * POST JSON to an upstream service (mutations / operator actions).
   */
  async postJson(
    url: string,
    body: Record<string, unknown> | undefined,
    correlationId?: string,
  ): Promise<UpstreamJsonResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (correlationId !== undefined && correlationId.length > 0) {
      headers['x-correlation-id'] = correlationId;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body:
          body !== undefined && Object.keys(body).length > 0
            ? JSON.stringify(body)
            : undefined,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn(`Upstream POST failed: ${url} — ${message}`);
      throw err;
    }

    const text = await res.text();
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = { raw: text };
      }
    }

    return { status: res.status, json };
  }

  /**
   * PATCH JSON to an upstream service.
   */
  async patchJson(
    url: string,
    body: Record<string, unknown>,
    correlationId?: string,
  ): Promise<UpstreamJsonResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (correlationId !== undefined && correlationId.length > 0) {
      headers['x-correlation-id'] = correlationId;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn(`Upstream PATCH failed: ${url} — ${message}`);
      throw err;
    }

    const text = await res.text();
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = { raw: text };
      }
    }

    return { status: res.status, json };
  }
}
