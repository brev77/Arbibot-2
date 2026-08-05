import {
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { signedFetch } from '@arbibot/nest-platform';

import type { AmountIns, ResolvedTokens } from './token-resolver.service';

/**
 * PlanSetupOrchestrator (PLAN10 P10-4, opp-service).
 *
 * Setup-only saga that creates a live execution plan from a risk_checked opportunity
 * and advances it to `executing` (legs created). It does NOT drive per-leg lifecycle —
 * that is the responsibility of LegAutoDriverWorker inside execution-orchestrator (P10-EO),
 * which keeps on-chain broadcast isolated near WalletManager/RPC.
 *
 * Sequence (5 HTTP calls):
 *   1. POST /execution/plans/multi-leg   (planned)
 *   2. POST /capital/reservations         (active)
 *   3. POST /execution/plans/:id/link-reservation  (reserved)
 *   4. POST /execution/plans/:id/arm      (armed)
 *   5. POST /execution/plans/:id/begin-execution   (executing, legs created)
 *
 * amountIn is pre-quoted (Модель #1, P10-3): both legs carry an amountIn derived from the
 * opportunity evidence, so sell leg knows its input without runtime chaining (which the
 * current schema doesn't support). `recipient` is omitted — execution-orchestrator's
 * WalletManager.selectWallet resolves it on the broadcast path (uniswap-v2.adapter.ts:573
 * and 4 other adapters). `notionalUsd` is also passed for the P10-AMT fallback path (EO
 * computes amountIn when not supplied).
 *
 * Cleanup on failure: capital reservation is released (idempotent best-effort). Capital
 * release on plan completion is handled by EO settlement-relay (independent of this worker).
 */

const DEFAULT_SLIPPAGE_BPS = 50;
const DEFAULT_RESERVATION_TTL_S = 300;
const HTTP_TIMEOUT_MS = 15_000;

export interface PlanSetupInput {
  correlationId: string;
  riskDecisionId: string;
  routeKey: string;
  notionalUsd: number;
  slippageBps?: number;
  tokens: ResolvedTokens;
  amountIns: AmountIns;
  buyVenueKey: string;
  sellVenueKey: string;
}

export interface PlanSetupResult {
  planId: string;
  reservationId: string;
}

interface PlanView {
  id: string;
  state: string;
}

interface ReservationView {
  id: string;
  state: string;
}

interface BeginExecutionResponse {
  plan: { id: string; state: string };
  legs: Array<{ id: string; legIndex: number; state: string }>;
}

@Injectable()
export class PlanSetupOrchestrator {
  private readonly logger = new Logger(PlanSetupOrchestrator.name);

  private readonly executionBaseUrl: string;
  private readonly capitalBaseUrl: string;

  constructor() {
    this.executionBaseUrl = (process.env.EXECUTION_API_BASE ?? 'http://127.0.0.1:3012').replace(
      /\/$/,
      '',
    );
    this.capitalBaseUrl = (process.env.CAPITAL_API_BASE ?? 'http://127.0.0.1:3011').replace(
      /\/$/,
      '',
    );
  }

  async orchestrate(input: PlanSetupInput): Promise<PlanSetupResult> {
    const slippage = input.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

    // Step 1: create multi-leg plan (planned)
    const plan = await this.createPlan(input, slippage);
    const planId = plan.id;

    // Step 2: reserve capital (active) — linked to planId so link-reservation's planId match check passes
    let reservationId: string | null = null;
    try {
      const reservation = await this.reserveCapital(input, planId);
      reservationId = reservation.id;
    } catch (err) {
      // No reservation to release; plan stays in `planned` (no capital consumed).
      this.logger.warn(
        `capital reserve failed for plan ${planId}: ${this.errMsg(err)} — plan left in 'planned'`,
      );
      throw err;
    }

    // Steps 3-5: link → arm → begin. On any failure, release the reservation (best-effort).
    try {
      await this.linkReservation(planId, reservationId);
      await this.arm(planId);
      await this.beginExecution(planId);
    } catch (err) {
      this.logger.warn(
        `plan ${planId} setup failed after reserve: ${this.errMsg(err)} — releasing reservation ${reservationId}`,
      );
      await this.releaseReservation(reservationId).catch(() => {
        /* best-effort; settlement-relay will release on planCompleted if it ever completes */
      });
      throw err;
    }

    return { planId, reservationId };
  }

  // ── Step implementations ────────────────────────────────────────────────

  private async createPlan(input: PlanSetupInput, slippageBps: number): Promise<PlanView> {
    const { tokens, amountIns } = input;
    // Pre-quoted amountOutExpected (fix #4, Модель #1): the buy leg expects to receive the
    // base amount that the sell leg will then use as its amountIn; the sell leg expects to
    // receive the quote amount the buy leg started with. UniV3 adapters REQUIRE amountOutExpected
    // and fee in the leg payload — without them submitLeg throws "no swap params for plan".
    // fee=500 = 0.05% pool fee tier (the most liquid tier for the pairs the scanner emits).
    const buyAmountOutExpected = amountIns.sellAmountIn;
    const sellAmountOutExpected = amountIns.buyAmountIn;
    const body = {
      correlationId: input.correlationId,
      riskDecisionId: input.riskDecisionId,
      routeKey: input.routeKey,
      notionalUsd: input.notionalUsd,
      legs: [
        {
          legType: 'dex' as const,
          chainId: tokens.chainId,
          venueKey: input.buyVenueKey,
          tokenIn: tokens.token1Address, // quote (USDC) → buy base
          tokenOut: tokens.token0Address,
          amountIn: amountIns.buyAmountIn,
          amountOutExpected: buyAmountOutExpected,
          fee: 500,
          slippageBps,
        },
        {
          legType: 'dex' as const,
          chainId: tokens.chainId,
          venueKey: input.sellVenueKey,
          tokenIn: tokens.token0Address, // base → sell for quote
          tokenOut: tokens.token1Address,
          amountIn: amountIns.sellAmountIn,
          amountOutExpected: sellAmountOutExpected,
          fee: 500,
          slippageBps,
        },
      ],
    };
    return this.signedPost(`${this.executionBaseUrl}/execution/plans/multi-leg`, body) as unknown as Promise<PlanView>;
  }

  private async reserveCapital(input: PlanSetupInput, planId: string): Promise<ReservationView> {
    const body = {
      correlationId: input.correlationId,
      planId,
      amountUsd: input.notionalUsd,
      ttlSeconds: DEFAULT_RESERVATION_TTL_S,
    };
    return this.signedPost(`${this.capitalBaseUrl}/capital/reservations`, body) as unknown as Promise<ReservationView>;
  }

  private async linkReservation(planId: string, reservationId: string): Promise<void> {
    await this.signedPost(
      `${this.executionBaseUrl}/execution/plans/${planId}/link-reservation`,
      { capitalReservationId: reservationId },
    );
  }

  private async arm(planId: string): Promise<void> {
    await this.signedPost(`${this.executionBaseUrl}/execution/plans/${planId}/arm`, {});
  }

  private async beginExecution(planId: string): Promise<BeginExecutionResponse> {
    const res = await this.signedPost(
      `${this.executionBaseUrl}/execution/plans/${planId}/begin-execution`,
      {},
    );
    return res as unknown as BeginExecutionResponse;
  }

  /** Best-effort release; idempotent (capital-service returns the released row on repeat). */
  async releaseReservation(reservationId: string): Promise<void> {
    await this.signedPost(
      `${this.capitalBaseUrl}/capital/reservations/${reservationId}/release`,
      {},
    );
  }

  // ── HTTP helper ──────────────────────────────────────────────────────────

  private async signedPost(url: string, body: unknown): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await signedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch {
      throw new ServiceUnavailableException(`upstream unreachable: ${url}`);
    }
    const text = await res.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* non-JSON */
      }
    }
    if (!res.ok) {
      // Preserve the upstream status (e.g. 409 from arm, 422 from cost-gate) so callers
      // can distinguish terminal failures from transient ones.
      throw new HttpException(parsed ?? text, res.status);
    }
    return (parsed ?? {}) as Record<string, unknown>;
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
