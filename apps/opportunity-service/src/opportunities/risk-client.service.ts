import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { signedFetch } from '@arbibot/nest-platform';

export type EvaluateRiskHttpResponse = {
  riskDecisionId: string;
  outboxMessageId?: string;
  outcome: string;
  notionalUsd: number;
  entityVersion: number;
  riskMode: string;
};

/**
 * Shape of `GET /risk-decisions/:id` on risk-service (RiskDecisionResponseDto).
 * Used by LiveAutoDriveWorker to inherit `correlationId` from the approved risk
 * decision so that `plan.correlationId === risk.correlationId` passes the
 * assertApprovedRiskViaHttp check in execution-orchestrator (plans.service.ts).
 */
export type RiskDecisionRecord = {
  id: string;
  correlationId: string;
  outcome: string;
};

@Injectable()
export class RiskClientService {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = (process.env.RISK_SERVICE_URL ?? 'http://127.0.0.1:3000').replace(
      /\/$/,
      '',
    );
  }

  async evaluateRisk(
    body: {
      correlationId: string;
      planReference: string;
      notionalUsd: number;
      snapshotVersion: number;
      riskMode?: 'fast' | 'standard' | 'conservative';
      idempotencyKey?: string;
      riskWindowReservationId?: string;
    },
    opts?: { traceCorrelationId?: string },
  ): Promise<EvaluateRiskHttpResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const trace = opts?.traceCorrelationId;
    if (trace !== undefined && trace.length > 0) {
      headers['x-correlation-id'] = trace;
    }

    let res: Response;
    try {
      res = await signedFetch(`${this.baseUrl}/evaluate-risk`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          correlationId: body.correlationId,
          planReference: body.planReference,
          notionalUsd: body.notionalUsd,
          snapshotVersion: body.snapshotVersion,
          riskMode: body.riskMode,
          idempotencyKey: body.idempotencyKey,
          riskWindowReservationId: body.riskWindowReservationId,
        }),
      });
    } catch {
      throw new ServiceUnavailableException('Risk service unreachable (network error)');
    }

    const text = await res.text();
    let json: unknown;
    try {
      json = text.length > 0 ? (JSON.parse(text) as unknown) : {};
    } catch {
      throw new ServiceUnavailableException(
        `Risk service returned non-JSON (HTTP ${res.status})`,
      );
    }

    if (!res.ok) {
      this.throwForRiskHttpStatus(res.status, text);
    }

    const o = json as Record<string, unknown>;
    const riskDecisionId = o.riskDecisionId;
    if (typeof riskDecisionId !== 'string') {
      throw new ServiceUnavailableException('Risk response missing riskDecisionId');
    }
    return {
      riskDecisionId,
      outboxMessageId:
        typeof o.outboxMessageId === 'string' ? o.outboxMessageId : undefined,
      outcome: typeof o.outcome === 'string' ? o.outcome : 'unknown',
      notionalUsd: typeof o.notionalUsd === 'number' ? o.notionalUsd : body.notionalUsd,
      entityVersion: typeof o.entityVersion === 'number' ? o.entityVersion : 1,
      riskMode: typeof o.riskMode === 'string' ? o.riskMode : 'standard',
    };
  }

  /**
   * Fetch a risk decision by id (GET /risk-decisions/:id). Used by the
   * LiveAutoDriveWorker to inherit the risk decision's `correlationId` so the
   * resulting execution plan passes `assertApprovedRiskViaHttp` (plans.service.ts:
   * `plan.correlationId !== null && risk.correlationId !== plan.correlationId`).
   *
   * Returns null on transient/404 errors so the worker can fall back to a
   * random correlationId (with a warn log) — never blocks plan creation.
   */
  async getRiskDecision(id: string): Promise<RiskDecisionRecord | null> {
    if (id.length === 0) {
      return null;
    }
    let res: Response;
    try {
      res = await signedFetch(`${this.baseUrl}/risk-decisions/${id}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
    } catch {
      // Network error — treat as transient; caller falls back.
      return null;
    }
    if (!res.ok) {
      // 404 (decision deleted/not found) or 5xx — caller falls back.
      return null;
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text.length > 0 ? (JSON.parse(text) as unknown) : null;
    } catch {
      return null;
    }
    if (json === null || typeof json !== 'object') {
      return null;
    }
    const o = json as Record<string, unknown>;
    const decisionId = typeof o.id === 'string' ? o.id : id;
    const correlationId = typeof o.correlationId === 'string' ? o.correlationId : '';
    const outcome = typeof o.outcome === 'string' ? o.outcome : 'unknown';
    if (correlationId.length === 0) {
      return null;
    }
    return { id: decisionId, correlationId, outcome };
  }

  private throwForRiskHttpStatus(status: number, bodyText: string): never {
    const snippet = bodyText.slice(0, 500);
    if (status === 400) {
      throw new BadRequestException(`Risk service rejected request: ${snippet}`);
    }
    if (status === 404) {
      throw new NotFoundException(`Risk service: not found (${snippet})`);
    }
    if (status === 409) {
      throw new ConflictException(`Risk service conflict / idempotency mismatch: ${snippet}`);
    }
    if (status >= 500) {
      throw new ServiceUnavailableException(`Risk service error HTTP ${status}: ${snippet}`);
    }
    throw new HttpException(
      `Risk service HTTP ${status}: ${snippet}`,
      status,
    );
  }

  correlationIdForOpportunity(stored: string | null): string {
    if (stored !== null && /^[0-9a-f-]{36}$/i.test(stored)) {
      return stored;
    }
    return randomUUID();
  }
}
