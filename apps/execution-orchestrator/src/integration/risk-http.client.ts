import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { getCorrelationId, signedFetch } from '@arbibot/nest-platform';

/** Authoritative read model from risk-service GET /risk-decisions/:id */
export type RiskDecisionSnapshot = {
  readonly id: string;
  readonly correlationId: string;
  readonly outcome: string;
};

function readRiskBaseUrl(): string {
  return (
    process.env.RISK_SERVICE_BASE_URL ??
    process.env.RISK_SERVICE_URL ??
    'http://127.0.0.1:3000'
  ).replace(/\/$/, '');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseSnapshot(body: unknown, decisionId: string): RiskDecisionSnapshot {
  if (!isRecord(body)) {
    throw new BadGatewayException(
      `risk-service: invalid JSON for risk-decisions ${decisionId}`,
    );
  }
  const id = body.id;
  const correlationId = body.correlationId;
  const outcome = body.outcome;
  if (typeof id !== 'string' || typeof correlationId !== 'string') {
    throw new BadGatewayException(
      `risk-service: missing id/correlationId for risk-decisions ${decisionId}`,
    );
  }
  if (typeof outcome !== 'string') {
    throw new BadGatewayException(
      `risk-service: missing outcome for risk-decisions ${decisionId}`,
    );
  }
  return { id, correlationId, outcome };
}

@Injectable()
export class RiskHttpClient {
  async getRiskDecision(id: string): Promise<RiskDecisionSnapshot> {
    const url = `${readRiskBaseUrl()}/risk-decisions/${id}`;
    const cid = getCorrelationId();
    const headers: Record<string, string> = {
      accept: 'application/json',
    };
    if (cid !== undefined && cid.length > 0) {
      headers['x-correlation-id'] = cid;
    }
    let res: Response;
    try {
      res = await signedFetch(url, { method: 'GET', headers });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadGatewayException(
        `risk-service unreachable for GET risk-decisions/${id}: ${msg}`,
      );
    }
    if (res.status === 404) {
      throw new NotFoundException(`Risk decision not found: ${id}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadGatewayException(
        `risk-service GET risk-decisions/${id} failed: ${res.status} ${text}`,
      );
    }
    let body: unknown;
    try {
      body = (await res.json()) as unknown;
    } catch {
      throw new BadGatewayException(
        `risk-service: non-JSON body for risk-decisions ${id}`,
      );
    }
    return parseSnapshot(body, id);
  }
}
