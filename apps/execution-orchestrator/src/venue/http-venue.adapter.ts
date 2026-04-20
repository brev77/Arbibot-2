import type { ExecutionLegEntity, ExecutionPlanEntity } from '@arbibot/persistence';
import { getCorrelationId } from '@arbibot/nest-platform';

import type {
  VenueAdapter,
  VenueHttpClientErrorCategory,
  VenueLegSubmitResult,
  VenueLegTerminalState,
} from './venue-adapter';
import {
  VenueSubmitClientError,
  VenueSubmitTransientError,
  VenueTerminalSubmitError,
} from './venue-adapter';

function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

/** Stable idempotency token for venue-side dedupe of leg submit (see `submitIdempotencyKey` in POST body). */
export function buildLegSubmitIdempotencyKey(legId: string): string {
  return `execution:leg:${legId}:submit`;
}

function readVenueHttpTimeoutMs(): number {
  const raw = process.env.VENUE_HTTP_TIMEOUT_MS?.trim() ?? '12000';
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) {
    return 12_000;
  }
  return Math.min(120_000, Math.max(1_000, n));
}

function parseTerminalState(value: unknown): VenueLegTerminalState | null {
  if (value === 'rejected') {
    return 'rejected';
  }
  if (value === 'timedOut' || value === 'timed_out') {
    return 'timedOut';
  }
  if (value === 'failed') {
    return 'failed';
  }
  return null;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function readVenueErrorCode(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const o = body as Record<string, unknown>;
  const direct =
    typeof o.venueErrorCode === 'string'
      ? o.venueErrorCode
      : typeof o.errorCode === 'string'
        ? o.errorCode
        : undefined;
  return direct?.trim() || undefined;
}

/** Maps HTTP status (+ optional JSON body) to a stable category for logs / future metrics. */
export function classifyVenueHttpClientError(
  status: number,
  body: unknown,
): VenueHttpClientErrorCategory {
  void body;
  if (status === 400) return 'validation';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'semantic';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'client_other';
  return 'client_other';
}

const VENUE_CATEGORY_VALUES: readonly VenueHttpClientErrorCategory[] = [
  'validation',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'semantic',
  'rate_limited',
  'client_other',
];

function isVenueCategory(v: string): v is VenueHttpClientErrorCategory {
  return (VENUE_CATEGORY_VALUES as readonly string[]).includes(v);
}

let venueCategoryMapCache: Map<string, VenueHttpClientErrorCategory> | null = null;
let venueCategoryMapEnvSnapshot: string | undefined;

/** Clears cache for tests or after `VENUE_HTTP_ERROR_CATEGORY_MAP` changes at runtime. */
export function resetVenueHttpClientCategoryMapCache(): void {
  venueCategoryMapCache = null;
  venueCategoryMapEnvSnapshot = undefined;
}

/**
 * Optional per-venue `venueErrorCode` → category mapping via env
 * `VENUE_HTTP_ERROR_CATEGORY_MAP` (JSON object). Keys: `venueErrorCode` or `STATUS:venueErrorCode`
 * for disambiguation (e.g. `"404:UNKNOWN_LEG":"not_found"`).
 */
export function resolveVenueHttpClientCategory(
  status: number,
  body: unknown,
): VenueHttpClientErrorCategory {
  const code = readVenueErrorCode(body);
  const raw = process.env.VENUE_HTTP_ERROR_CATEGORY_MAP?.trim();
  if (raw !== venueCategoryMapEnvSnapshot) {
    venueCategoryMapCache = null;
    venueCategoryMapEnvSnapshot = raw;
  }
  if (venueCategoryMapCache === null) {
    venueCategoryMapCache = new Map();
    if (raw !== undefined && raw.length > 0) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        for (const [key, val] of Object.entries(parsed)) {
          if (typeof key !== 'string' || typeof val !== 'string') {
            continue;
          }
          const k = key.trim();
          if (k.length === 0 || !isVenueCategory(val)) {
            continue;
          }
          venueCategoryMapCache.set(k, val);
        }
      } catch {
        /* invalid JSON — fallback to status-only classification */
      }
    }
  }
  if (code !== undefined && venueCategoryMapCache.size > 0) {
    const scoped = `${status}:${code}`;
    const hit = venueCategoryMapCache.get(scoped) ?? venueCategoryMapCache.get(code);
    if (hit !== undefined) {
      return hit;
    }
  }
  return classifyVenueHttpClientError(status, body);
}

function resolveCorrelationHeader(plan: ExecutionPlanEntity): string | undefined {
  const fromAls = getCorrelationId()?.trim();
  if (fromAls !== undefined && fromAls.length > 0) {
    return fromAls;
  }
  const fromPlan = plan.correlationId?.trim();
  if (fromPlan !== undefined && fromPlan.length > 0) {
    return fromPlan;
  }
  return undefined;
}

/**
 * HTTP-backed venue: POST JSON to `{base}/v1/submit-leg` for each leg submit.
 * Intended for sandbox/paper HTTP fronts or local lab stands (see `tools/lab-venue-stand.mjs`).
 *
 * Enable with **`VENUE_HTTP_BASE_URL`** (non-empty). When unset, orchestrator uses {@link MockVenueAdapter}.
 *
 * **Idempotency:** the JSON body includes **`submitIdempotencyKey`** (`execution:leg:{legId}:submit`).
 * Production venue endpoints should treat repeats of the same key as the same logical submit
 * and return the same `externalOrderId` (see `.env.example` HTTP venue block).
 */
export class HttpVenueAdapter implements VenueAdapter {
  constructor(private readonly baseUrl: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  async submitLeg(
    plan: ExecutionPlanEntity,
    leg: ExecutionLegEntity,
  ): Promise<VenueLegSubmitResult> {
    const url = `${this.baseUrl}/v1/submit-leg`;
    const timeoutMs = readVenueHttpTimeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const submitIdempotencyKey = buildLegSubmitIdempotencyKey(leg.id);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const correlation = resolveCorrelationHeader(plan);
    if (correlation !== undefined) {
      headers['x-correlation-id'] = correlation;
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          planId: plan.id,
          legId: leg.id,
          legIndex: leg.legIndex,
          submitIdempotencyKey,
        }),
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new VenueSubmitTransientError(
          `HttpVenueAdapter: submit timed out after ${timeoutMs}ms (${url})`,
        );
      }
      const detail = err instanceof Error ? err.message : String(err);
      throw new VenueSubmitTransientError(
        `HttpVenueAdapter: network error submitting to ${url}: ${detail}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let body: unknown = {};
    if (text.length > 0) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        if (res.ok) {
          throw new VenueSubmitClientError(
            `HttpVenueAdapter: ${res.status} invalid JSON from ${url}; check venue logs`,
            { httpStatus: res.status, category: 'validation' },
          );
        }
        body = {};
      }
    }

    if (res.ok) {
      if (typeof body === 'object' && body !== null && 'externalOrderId' in body) {
        const id = (body as { externalOrderId?: unknown }).externalOrderId;
        if (typeof id === 'string' && id.length > 0) {
          return { externalOrderId: id };
        }
      }
      throw new VenueSubmitClientError(
        `HttpVenueAdapter: ${res.status} missing externalOrderId from ${url}; check venue logs`,
        { httpStatus: res.status, category: 'validation' },
      );
    }

    if (
      res.status === 408 ||
      res.status === 429 ||
      res.status === 502 ||
      res.status === 503 ||
      res.status === 504
    ) {
      throw new VenueSubmitTransientError(
        `HttpVenueAdapter: transient HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`,
      );
    }

    if (res.status === 409 && typeof body === 'object' && body !== null) {
      const terminal = parseTerminalState(
        (body as { terminalState?: unknown; terminal_state?: unknown }).terminalState ??
          (body as { terminal_state?: unknown }).terminal_state,
      );
      if (terminal !== null) {
        throw new VenueTerminalSubmitError(
          `HttpVenueAdapter: terminal submit from ${url}: ${text.slice(0, 200)}`,
          terminal,
        );
      }
      const vcode = readVenueErrorCode(body);
      throw new VenueSubmitClientError(
        `HttpVenueAdapter: 409 conflict without terminalState from ${url}: ${text.slice(0, 200)}`,
        {
          httpStatus: 409,
          category: resolveVenueHttpClientCategory(409, body),
          venueErrorCode: vcode,
        },
      );
    }

    if (res.status >= 500) {
      throw new VenueSubmitTransientError(
        `HttpVenueAdapter: server error ${res.status} from ${url}: ${text.slice(0, 200)}`,
      );
    }

    if (res.status >= 400 && res.status < 500) {
      // Taxonomy: 400 validation, 401/403 authz, 404 unknown leg, 408 timeout (also handled above),
      // 409 conflict+terminalState (handled above), 422 semantic / venue-specific business rule.
      const category = resolveVenueHttpClientCategory(res.status, body);
      throw new VenueSubmitClientError(
        `HttpVenueAdapter: client HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`,
        {
          httpStatus: res.status,
          category,
          venueErrorCode: readVenueErrorCode(body),
        },
      );
    }

    throw new VenueSubmitTransientError(
      `HttpVenueAdapter: unexpected HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`,
    );
  }
}
