import { Injectable, Logger } from '@nestjs/common';

import { getCorrelationId } from './correlation';

export type AuditRecordInput = {
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
  readonly actor: string;
  readonly action: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly payload?: Record<string, unknown>;
};

/**
 * Contract for best-effort audit emission (tests may provide a stub).
 * `record` is fire-and-forget; `appendEntry` awaits the HTTP round-trip.
 */
export interface IAuditClient {
  record(input: AuditRecordInput): void;
  appendEntry(input: AuditRecordInput): Promise<void>;
}

function parseTimeoutMs(): number {
  const raw = process.env.AUDIT_CLIENT_TIMEOUT_MS;
  if (raw === undefined || raw.length === 0) {
    return 5000;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 60_000) : 5000;
}

/**
 * Best-effort HTTP client for audit-service (`POST /audit/entries`).
 * Failures are logged; domain operations are not blocked when using `record`.
 * Correlation: uses `input.correlationId` when set; otherwise `getCorrelationId()`
 * from request ALS when `correlationIdPreHandler` is installed.
 */
@Injectable()
export class AuditClientService implements IAuditClient {
  private readonly logger = new Logger(AuditClientService.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor() {
    this.baseUrl = (
      process.env.AUDIT_SERVICE_URL ?? 'http://127.0.0.1:3013'
    ).replace(/\/$/, '');
    this.timeoutMs = parseTimeoutMs();
  }

  record(input: AuditRecordInput): void {
    if (process.env.AUDIT_CLIENT_ENABLED === 'false') {
      return;
    }
    void this.send(input).catch((err: unknown) => {
      this.logger.warn(
        `Audit append failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  async appendEntry(input: AuditRecordInput): Promise<void> {
    if (process.env.AUDIT_CLIENT_ENABLED === 'false') {
      return;
    }
    await this.send(input);
  }

  private resolveCorrelationId(input: AuditRecordInput): string | undefined {
    if (input.correlationId !== undefined && input.correlationId.length > 0) {
      return input.correlationId;
    }
    const fromAls = getCorrelationId();
    if (fromAls !== undefined && fromAls.length > 0) {
      return fromAls;
    }
    return undefined;
  }

  private async send(input: AuditRecordInput): Promise<void> {
    const correlationId = this.resolveCorrelationId(input);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (correlationId !== undefined) {
      headers['x-correlation-id'] = correlationId;
    }
    const res = await fetch(`${this.baseUrl}/audit/entries`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        idempotencyKey: input.idempotencyKey,
        correlationId,
        actor: input.actor,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        payload: input.payload,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
  }
}
