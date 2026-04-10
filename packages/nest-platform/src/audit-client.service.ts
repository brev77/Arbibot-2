import { Injectable, Logger } from '@nestjs/common';

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
 * Best-effort HTTP client for audit-service (`POST /audit/entries`).
 * Failures are logged; domain operations are not blocked.
 */
@Injectable()
export class AuditClientService {
  private readonly logger = new Logger(AuditClientService.name);
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = (
      process.env.AUDIT_SERVICE_URL ?? 'http://127.0.0.1:3013'
    ).replace(/\/$/, '');
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

  private async send(input: AuditRecordInput): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (
      input.correlationId !== undefined &&
      input.correlationId.length > 0
    ) {
      headers['x-correlation-id'] = input.correlationId;
    }
    const res = await fetch(`${this.baseUrl}/audit/entries`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
        actor: input.actor,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        payload: input.payload,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
    }
  }
}
