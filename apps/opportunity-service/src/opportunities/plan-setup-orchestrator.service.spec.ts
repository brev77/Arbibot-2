import { HttpException, ServiceUnavailableException } from '@nestjs/common';

import { PlanSetupOrchestrator } from './plan-setup-orchestrator.service';
import type { AmountIns, ResolvedTokens } from './token-resolver.service';

/**
 * PLAN10 P10-4 — PlanSetupOrchestrator spec.
 *
 * Setup-only saga (5 steps). Mocks global.fetch to assert the HTTP sequence and cleanup
 * semantics. Covers: happy path, link/arm 4xx→cleanup+release, begin-execution 422
 * (cost gate)→cleanup+release, capital-service unreachable→no reservation to release.
 */

const TOKENS: ResolvedTokens = {
  token0Address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
  token1Address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
  decimals0: 18,
  decimals1: 6,
  chainId: 42161,
};

const AMOUNT_INS: AmountIns = {
  buyAmountIn: '10000000', // 10 USDC
  sellAmountIn: '5000000000000000', // 0.005 WETH
};

const originalFetch = global.fetch;

function mockResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

function makeInput(overrides: Partial<Parameters<PlanSetupOrchestrator['orchestrate']>[0]> = {}) {
  return {
    correlationId: '11111111-1111-4111-8111-111111111111',
    riskDecisionId: '22222222-2222-4222-8222-222222222222',
    routeKey: 'arb:42161:WETH-USDC',
    notionalUsd: 10,
    tokens: TOKENS,
    amountIns: AMOUNT_INS,
    buyVenueKey: 'uniswap-v2',
    sellVenueKey: 'sushiswap',
    // FIX-C: grossProfitUsd is required on PlanSetupInput (capital-safety: without it the
    // EO cost gate stays fail-OPEN). Tests that need to exercise the gate-OPEN path can
    // override to 0; otherwise a small positive gross is the realistic default.
    grossProfitUsd: 1.5,
    ...overrides,
  };
}

describe('PlanSetupOrchestrator', () => {
  let svc: PlanSetupOrchestrator;
  const calls: Array<{ url: string; method: string }> = [];

  beforeEach(() => {
    calls.length = 0;
    process.env.EXECUTION_API_BASE = 'http://exec';
    process.env.CAPITAL_API_BASE = 'http://cap';
    svc = new PlanSetupOrchestrator();
    global.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: String(init.method) });
      return Promise.resolve(mockResponse({ id: 'plan-1', state: 'planned' }));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.EXECUTION_API_BASE;
    delete process.env.CAPITAL_API_BASE;
  });

  it('happy path: create→reserve→link→arm→begin in order', async () => {
    // Sequence responses via a state machine keyed off URL.
    let planState = 'planned';
    global.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: String(init.method) });
      const u = String(url);
      if (u.endsWith('/multi-leg')) {
        planState = 'planned';
        return Promise.resolve(mockResponse({ id: 'plan-1', state: planState }));
      }
      if (u.endsWith('/reservations') && init.method === 'POST') {
        return Promise.resolve(mockResponse({ id: 'resv-1', state: 'active' }));
      }
      if (u.endsWith('/link-reservation')) {
        planState = 'reserved';
        return Promise.resolve(mockResponse({ id: 'plan-1', state: planState }));
      }
      if (u.endsWith('/arm')) {
        planState = 'armed';
        return Promise.resolve(mockResponse({ id: 'plan-1', state: planState }));
      }
      if (u.endsWith('/begin-execution')) {
        planState = 'executing';
        return Promise.resolve(
          mockResponse({
            plan: { id: 'plan-1', state: planState },
            legs: [{ id: 'leg-0', legIndex: 0, state: 'created' }],
          }),
        );
      }
      return Promise.resolve(mockResponse({}));
    }) as unknown as typeof fetch;

    const result = await svc.orchestrate(makeInput());
    expect(result.planId).toBe('plan-1');
    expect(result.reservationId).toBe('resv-1');
    // 5 setup calls, no release on success.
    expect(calls.map((c) => c.url)).toEqual([
      'http://exec/execution/plans/multi-leg',
      'http://cap/capital/reservations',
      'http://exec/execution/plans/plan-1/link-reservation',
      'http://exec/execution/plans/plan-1/arm',
      'http://exec/execution/plans/plan-1/begin-execution',
    ]);
  });

  it('begin-execution 422 (cost gate) → releases reservation + rethrows', async () => {
    let reservationReleased = false;
    global.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: String(init.method) });
      const u = String(url);
      if (u.endsWith('/multi-leg')) return Promise.resolve(mockResponse({ id: 'plan-1', state: 'planned' }));
      if (u.endsWith('/reservations') && init.method === 'POST') return Promise.resolve(mockResponse({ id: 'resv-1', state: 'active' }));
      if (u.endsWith('/link-reservation')) return Promise.resolve(mockResponse({ id: 'plan-1', state: 'reserved' }));
      if (u.endsWith('/arm')) return Promise.resolve(mockResponse({ id: 'plan-1', state: 'armed' }));
      if (u.endsWith('/begin-execution')) return Promise.resolve(mockResponse({ error: 'cost-gate-blocked' }, 422));
      if (u.endsWith('/release')) {
        reservationReleased = true;
        return Promise.resolve(mockResponse({ id: 'resv-1', state: 'released' }));
      }
      return Promise.resolve(mockResponse({}));
    }) as unknown as typeof fetch;

    await expect(svc.orchestrate(makeInput())).rejects.toBeInstanceOf(HttpException);
    expect(reservationReleased).toBe(true);
  });

  it('capital-service unreachable on reserve → rethrows, no reservation to release', async () => {
    let releaseCalled = false;
    global.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: String(init.method) });
      const u = String(url);
      if (u.endsWith('/multi-leg')) return Promise.resolve(mockResponse({ id: 'plan-1', state: 'planned' }));
      if (u.endsWith('/reservations')) throw new TypeError('ECONNREFUSED');
      if (u.endsWith('/release')) {
        releaseCalled = true;
        return Promise.resolve(mockResponse({ id: 'resv-1', state: 'released' }));
      }
      return Promise.resolve(mockResponse({}));
    }) as unknown as typeof fetch;

    await expect(svc.orchestrate(makeInput())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(releaseCalled).toBe(false); // no reservation was created
  });

  it('multi-leg body includes pre-quoted amountIn on both legs + notionalUsd', async () => {
    let capturedBody: unknown;
    global.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: String(init.method) });
      const u = String(url);
      if (u.endsWith('/multi-leg')) {
        const rawBody = typeof init.body === 'string' ? init.body : '';
        capturedBody = JSON.parse(rawBody);
        return Promise.resolve(mockResponse({ id: 'plan-1', state: 'planned' }));
      }
      if (u.endsWith('/reservations')) return Promise.resolve(mockResponse({ id: 'resv-1', state: 'active' }));
      if (u.endsWith('/link-reservation')) return Promise.resolve(mockResponse({ state: 'reserved' }));
      if (u.endsWith('/arm')) return Promise.resolve(mockResponse({ state: 'armed' }));
      if (u.endsWith('/begin-execution')) return Promise.resolve(mockResponse({ plan: { state: 'executing' }, legs: [] }));
      return Promise.resolve(mockResponse({}));
    }) as unknown as typeof fetch;

    await svc.orchestrate(makeInput());
    const body = capturedBody as { notionalUsd: number; legs: Array<{ amountIn: string; tokenIn: string; tokenOut: string }> };
    expect(body.notionalUsd).toBe(10);
    expect(body.legs).toHaveLength(2);
    // buy leg: USDC → WETH
    const buyLeg = body.legs[0]!;
    expect(buyLeg.tokenIn).toBe(TOKENS.token1Address);
    expect(buyLeg.tokenOut).toBe(TOKENS.token0Address);
    expect(buyLeg.amountIn).toBe(AMOUNT_INS.buyAmountIn);
    // sell leg: WETH → USDC
    const sellLeg = body.legs[1]!;
    expect(sellLeg.tokenIn).toBe(TOKENS.token0Address);
    expect(sellLeg.tokenOut).toBe(TOKENS.token1Address);
    expect(sellLeg.amountIn).toBe(AMOUNT_INS.sellAmountIn);
  });

  it('legs include pre-quoted amountOutExpected + fee (fix #4 — UniV3 needs both)', async () => {
    // UniV3 adapters require amountOutExpected and fee in the leg payload; without them
    // submitLeg throws "no swap params for plan". The buy leg's amountOutExpected equals
    // the sell leg's amountIn (Модель #1: buy expects to receive the base amount the sell
    // will consume), and vice versa.
    let capturedBody: unknown;
    global.fetch = ((url: string, init: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/multi-leg')) {
        capturedBody = JSON.parse(typeof init.body === 'string' ? init.body : '');
        return Promise.resolve(mockResponse({ id: 'plan-1', state: 'planned' }));
      }
      if (u.endsWith('/reservations')) return Promise.resolve(mockResponse({ id: 'resv-1', state: 'active' }));
      if (u.endsWith('/link-reservation')) return Promise.resolve(mockResponse({ state: 'reserved' }));
      if (u.endsWith('/arm')) return Promise.resolve(mockResponse({ state: 'armed' }));
      if (u.endsWith('/begin-execution')) return Promise.resolve(mockResponse({ plan: { state: 'executing' }, legs: [] }));
      return Promise.resolve(mockResponse({}));
    }) as unknown as typeof fetch;

    await svc.orchestrate(makeInput());
    const body = capturedBody as {
      legs: Array<{
        amountIn: string;
        amountOutExpected?: string;
        fee?: number;
      }>;
    };
    expect(body.legs).toHaveLength(2);
    const buyLeg = body.legs[0]!;
    const sellLeg = body.legs[1]!;
    // Cross-quote: buy's amountOutExpected = sell's amountIn (the base amount).
    expect(buyLeg.amountOutExpected).toBe(AMOUNT_INS.sellAmountIn);
    expect(sellLeg.amountOutExpected).toBe(AMOUNT_INS.buyAmountIn);
    // FIX-D (2026-08-11): fee tier defaults to SAFE_DEFAULT_FEE_TIER=3000 (0.3%) when the
    // caller does not supply buyFeeTier/sellFeeTier — safer than the old hardcoded 500,
    // which selected thin pools for long-tail pairs (CRV/WETH fee=500 ~3000× less liquid).
    // makeInput() omits buyFeeTier → falls back to 3000.
    expect(buyLeg.fee).toBe(3000);
    expect(sellLeg.fee).toBe(3000);
  });

  it('FIX-D: uses caller-supplied buyFeeTier/sellFeeTier when provided', async () => {
    let capturedBody: unknown = undefined;
    global.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url: String(url), method: String(init.method) });
      const u = String(url);
      if (u.endsWith('/multi-leg') && init.method === 'POST') {
        capturedBody = JSON.parse(init.body as string);
        return Promise.resolve(mockResponse({ id: 'plan-1', state: 'planned' }));
      }
      if (u.endsWith('/reservations')) return Promise.resolve(mockResponse({ id: 'resv-1', state: 'active' }));
      if (u.endsWith('/link-reservation')) return Promise.resolve(mockResponse({ state: 'reserved' }));
      if (u.endsWith('/arm')) return Promise.resolve(mockResponse({ state: 'armed' }));
      if (u.endsWith('/begin-execution')) return Promise.resolve(mockResponse({ plan: { state: 'executing' }, legs: [] }));
      return Promise.resolve(mockResponse({}));
    }) as unknown as typeof fetch;

    await svc.orchestrate(makeInput({ buyFeeTier: 500, sellFeeTier: 3000 }));
    const body = capturedBody as { legs: Array<{ fee?: number }> };
    expect(body.legs[0]!.fee).toBe(500);
    expect(body.legs[1]!.fee).toBe(3000);
  });

  it('FIX-C: forwards grossProfitUsd into the multi-leg body', async () => {
    let capturedBody: unknown = undefined;
    global.fetch = ((url: string, init: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/multi-leg') && init.method === 'POST') {
        capturedBody = JSON.parse(init.body as string);
        return Promise.resolve(mockResponse({ id: 'plan-1', state: 'planned' }));
      }
      if (u.endsWith('/reservations')) return Promise.resolve(mockResponse({ id: 'resv-1', state: 'active' }));
      if (u.endsWith('/link-reservation')) return Promise.resolve(mockResponse({ state: 'reserved' }));
      if (u.endsWith('/arm')) return Promise.resolve(mockResponse({ state: 'armed' }));
      if (u.endsWith('/begin-execution')) return Promise.resolve(mockResponse({ plan: { state: 'executing' }, legs: [] }));
      return Promise.resolve(mockResponse({}));
    }) as unknown as typeof fetch;

    await svc.orchestrate(makeInput({ grossProfitUsd: 2.34 }));
    expect((capturedBody as { grossProfitUsd?: number }).grossProfitUsd).toBe(2.34);
  });
});
