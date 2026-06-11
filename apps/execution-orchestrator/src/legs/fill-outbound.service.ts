import { Injectable } from '@nestjs/common';

import { PORTFOLIO_HTTP_ROUTES } from '@arbibot/contracts';
import { getCorrelationId } from '@arbibot/nest-platform';

import { PlansService } from '../plans/plans.service';

export type LegFilledSettlementArgs = {
  readonly planId: string;
  readonly legId: string;
  readonly legIndex: number;
  readonly filledQuantity: number;
  /** Canonical portfolio grouping key (plan `routeKey`, risk decision, or plan id). */
  readonly instrumentKey: string;
  readonly correlationId: string | null;
};

const TRANSIENT_HTTP = new Set([429, 502, 503, 504]);

function readSimulatedPortfolioFailureLegIndexes(): Set<number> {
  const raw =
    process.env.EXECUTION_SETTLEMENT_SIMULATE_PORTFOLIO_FAILURE_ON_LEG_INDEXES?.trim() ?? '';
  if (raw.length === 0) {
    return new Set();
  }
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n >= 0) {
      out.add(n);
    }
  }
  return out;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts?: { retries?: number },
): Promise<Response> {
  const retries = opts?.retries ?? 4;
  let last: Response | undefined;
  for (let attempt = 0; attempt < retries; attempt++) {
    last = await fetch(url, init);
    if (last.ok) {
      return last;
    }
    if (!TRANSIENT_HTTP.has(last.status)) {
      return last;
    }
    await new Promise((r) => setTimeout(r, 80 * (attempt + 1)));
  }
  return last!;
}

/**
 * Post-commit settlement: portfolio (HTTP) + plan completion + capital release (HTTP).
 * Gated by `EXECUTION_SETTLEMENT_ENABLED=true` so unit tests stay hermetic.
 */
@Injectable()
export class FillOutboundService {
  constructor(private readonly plans: PlansService) {}

  async afterLegFullyFilled(args: LegFilledSettlementArgs): Promise<void> {
    // Always mark plan completed when all legs are filled — this must not be
    // gated by the optional settlement flag, otherwise plans stay in
    // "executing" forever when settlement is disabled.
    const { completed, plan } =
      await this.plans.tryMarkPlanCompletedWhenAllLegsFilled(args.planId);

    // Settlement (portfolio confirm + capital release) is optional and
    // gated separately by EXECUTION_SETTLEMENT_ENABLED.
    if (process.env.EXECUTION_SETTLEMENT_ENABLED !== 'true') {
      return;
    }

    await this.confirmPortfolio(args);

    if (
      completed &&
      plan !== null &&
      plan.capitalReservationId !== null &&
      plan.capitalReservationId.length > 0
    ) {
      await this.releaseCapital(plan.capitalReservationId);
    }
  }

  private async confirmPortfolio(args: LegFilledSettlementArgs): Promise<void> {
    if (readSimulatedPortfolioFailureLegIndexes().has(args.legIndex)) {
      throw new Error(
        `Simulated portfolio confirm-fill failure (EXECUTION_SETTLEMENT_SIMULATE_PORTFOLIO_FAILURE_ON_LEG_INDEXES includes legIndex=${args.legIndex})`,
      );
    }
    const base =
      process.env.PORTFOLIO_SERVICE_URL ?? process.env.PORTFOLIO_API_BASE;
    if (base === undefined || base.length === 0) {
      throw new Error(
        'EXECUTION_SETTLEMENT_ENABLED=true requires PORTFOLIO_SERVICE_URL or PORTFOLIO_API_BASE; refusing silent skip of portfolio confirm-fill',
      );
    }
    const path = PORTFOLIO_HTTP_ROUTES.confirmFill.replace(/^POST\s+/, '');
    const url = `${base.replace(/\/$/, '')}/${path}`;
    const cid = getCorrelationId();
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (cid !== undefined && cid.length > 0) {
      headers['x-correlation-id'] = cid;
    }
    if (args.correlationId !== null && args.correlationId.length > 0) {
      headers['x-correlation-id'] = args.correlationId;
    }
    const body = {
      planId: args.planId,
      legId: args.legId,
      instrumentKey: args.instrumentKey,
      quantity: String(args.filledQuantity),
      idempotencyKey: `portfolio:fill:${args.legId}`,
    };
    const res = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      throw new Error(
        `Portfolio confirm-fill failed: ${res.status} ${await res.text()}`,
      );
    }
  }

  private async releaseCapital(reservationId: string): Promise<void> {
    const base =
      process.env.CAPITAL_SERVICE_BASE_URL ??
      process.env.CAPITAL_SERVICE_URL ??
      'http://127.0.0.1:3011';
    const cid = getCorrelationId();
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (cid !== undefined && cid.length > 0) {
      headers['x-correlation-id'] = cid;
    }
    const res = await fetchWithRetry(
      `${base.replace(/\/$/, '')}/capital/reservations/${reservationId}/release`,
      { method: 'POST', headers, body: '{}' },
    );
    if (!res.ok) {
      throw new Error(
        `Capital release failed: ${res.status} ${await res.text()}`,
      );
    }
  }
}
