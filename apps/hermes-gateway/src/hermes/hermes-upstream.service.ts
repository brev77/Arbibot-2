import { Injectable, Logger } from '@nestjs/common';

import { signedFetch } from '@arbibot/nest-platform';

export type UpstreamJsonResult = {
  status: number;
  json: unknown;
};

/**
 * Whether outbound upstream calls should carry a service-auth HMAC signature.
 *
 * Hermes-gateway proxies to caller-supplied URLs (its gateway role), so signing
 * is env-gated rather than unconditional: in dev/paper (`HERMES_SIGN_UPSTREAM`
 * unset/false) calls are an unsigned passthrough; in live (`HERMES_SIGN_UPSTREAM=true`)
 * every upstream call is signed with `ARBIBOT_SERVICE_AUTH_SECRET`. When signing
 * is forced but the secret is missing, `signedFetch` throws (fail-closed) — see
 * D4-B-6-MTLS / docs/adr-service-auth.md.
 */
function shouldSignUpstream(): boolean {
  return process.env.HERMES_SIGN_UPSTREAM === 'true';
}

@Injectable()
export class HermesUpstreamService {
  private readonly log = new Logger(HermesUpstreamService.name);
  private readonly signUpstream = shouldSignUpstream();

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
      res = await signedFetch(url, { method: 'GET', headers, forceSign: this.signUpstream });
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
      res = await signedFetch(url, {
        method: 'POST',
        headers,
        forceSign: this.signUpstream,
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
      res = await signedFetch(url, {
        method: 'PATCH',
        headers,
        forceSign: this.signUpstream,
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

  /**
   * PUT JSON to an upstream service (Plan 6 — config-service `PUT /policy/configurations/:key`).
   */
  async putJson(
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
      res = await signedFetch(url, {
        method: 'PUT',
        headers,
        forceSign: this.signUpstream,
        body: JSON.stringify(body),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn(`Upstream PUT failed: ${url} — ${message}`);
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
