import { Injectable, Logger } from '@nestjs/common';

import { PORTFOLIO_HTTP_ROUTES } from '@arbibot/contracts';
import { Address } from '@arbibot/contracts-eth';
import { getCorrelationId } from '@arbibot/nest-platform';

import { PlansService } from '../plans/plans.service';
import { PriceOracleService } from '../execution/price/price-oracle.service';

export type LegFilledSettlementArgs = {
  readonly planId: string;
  readonly legId: string;
  readonly legIndex: number;
  readonly filledQuantity: number;
  /** Canonical portfolio grouping key (plan `routeKey`, risk decision, or plan id). */
  readonly instrumentKey: string;
  readonly correlationId: string | null;
  /**
   * Optional DEX leg context used to price the fill into a USD notional
   * (D4-B-3-CEILING). Resolved by the caller from the leg's on-chain tx
   * (`chainId`) + playbook leg (`tokenIn`). Absent for non-DEX legs → notional
   * stays '0' (position row still created by portfolio-service).
   */
  readonly chainId?: number;
  readonly tokenIn?: string;
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
  private readonly logger = new Logger(FillOutboundService.name);

  constructor(
    private readonly plans: PlansService,
    private readonly priceOracle: PriceOracleService,
  ) {}

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
      notionalUsd: await this.priceFillNotional(args),
      idempotencyKey: `portfolio:fill:${args.legId}`,
    };
    const res = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      throw new Error(
        `Portfolio confirm-fill failed: ${res.status} ${await res.text()}`,
      );
    }
  }

  /**
   * D4-B-3-CEILING: price a just-filled leg into a USD notional string so
   * portfolio-service can accumulate it into `portfolio_positions.notional_usd`
   * (counted into the aggregate capital ceiling when the position is open).
   *
   * Re-prices `tokenIn` via the price oracle at fill time. Best-effort: oracle
   * `null` or missing leg context → '0' (position row still created; settlement
   * is already post-broadcast, so a missing notional must never block the fill).
   */
  private async priceFillNotional(args: LegFilledSettlementArgs): Promise<string> {
    if (args.chainId === undefined || args.tokenIn === undefined) {
      return '0';
    }
    try {
      const tokenIn = args.tokenIn as Address;
      const priceUsd = await this.priceOracle.getTokenPriceUsd(args.chainId, tokenIn);
      if (priceUsd === null) {
        this.logger.warn(
          `priceFillNotional: oracle returned null for tokenIn=${args.tokenIn} on chain=${args.chainId}; notional=0`,
        );
        return '0';
      }
      const decimals = await this.priceOracle.getTokenDecimals(args.chainId, tokenIn);
      if (decimals === null) {
        this.logger.warn(
          `priceFillNotional: decimals unresolved for tokenIn=${args.tokenIn} on chain=${args.chainId}; notional=0`,
        );
        return '0';
      }
      const units = args.filledQuantity / 10 ** decimals;
      const notionalUsd = units * priceUsd;
      return Number.isFinite(notionalUsd) && notionalUsd > 0
        ? notionalUsd.toFixed(8)
        : '0';
    } catch (e) {
      this.logger.warn(
        `priceFillNotional failed (chain=${args.chainId}, tokenIn=${args.tokenIn}): ${e instanceof Error ? e.message : String(e)}; notional=0`,
      );
      return '0';
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
