import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { getCorrelationId } from '@arbibot/nest-platform';

/** Authoritative read model from capital-service GET /capital/reservations/:id */
export type CapitalReservationSnapshot = {
  readonly id: string;
  readonly state: string;
  readonly correlationId: string | null;
  readonly planId: string | null;
  readonly expiresAtIso: string;
};

function readCapitalBaseUrl(): string {
  return (
    process.env.CAPITAL_SERVICE_BASE_URL ??
    process.env.CAPITAL_SERVICE_URL ??
    'http://127.0.0.1:3011'
  ).replace(/\/$/, '');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseSnapshot(body: unknown, reservationId: string): CapitalReservationSnapshot {
  if (!isRecord(body)) {
    throw new BadGatewayException(
      `capital-service: invalid JSON for reservation ${reservationId}`,
    );
  }
  const id = body.id;
  const state = body.state;
  const amountUsd = body.amountUsd;
  const expiresAt = body.expiresAt;
  if (typeof id !== 'string' || typeof state !== 'string') {
    throw new BadGatewayException(
      `capital-service: missing id/state for reservation ${reservationId}`,
    );
  }
  if (typeof amountUsd !== 'string') {
    throw new BadGatewayException(
      `capital-service: missing amountUsd for reservation ${reservationId}`,
    );
  }
  if (typeof expiresAt !== 'string') {
    throw new BadGatewayException(
      `capital-service: missing expiresAt for reservation ${reservationId}`,
    );
  }
  const correlationId =
    body.correlationId === null || body.correlationId === undefined
      ? null
      : typeof body.correlationId === 'string'
        ? body.correlationId
        : null;
  const planId =
    body.planId === null || body.planId === undefined
      ? null
      : typeof body.planId === 'string'
        ? body.planId
        : null;
  return {
    id,
    state,
    correlationId,
    planId,
    expiresAtIso: expiresAt,
  };
}

@Injectable()
export class CapitalHttpClient {
  async getReservation(id: string): Promise<CapitalReservationSnapshot> {
    const url = `${readCapitalBaseUrl()}/capital/reservations/${id}`;
    const cid = getCorrelationId();
    const headers: Record<string, string> = {
      accept: 'application/json',
    };
    if (cid !== undefined && cid.length > 0) {
      headers['x-correlation-id'] = cid;
    }
    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', headers });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadGatewayException(
        `capital-service unreachable for GET reservations/${id}: ${msg}`,
      );
    }
    if (res.status === 404) {
      throw new NotFoundException(`Reservation not found: ${id}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadGatewayException(
        `capital-service GET reservations/${id} failed: ${res.status} ${text}`,
      );
    }
    let body: unknown;
    try {
      body = (await res.json()) as unknown;
    } catch {
      throw new BadGatewayException(
        `capital-service: non-JSON body for reservation ${id}`,
      );
    }
    return parseSnapshot(body, id);
  }
}
