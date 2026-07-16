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
