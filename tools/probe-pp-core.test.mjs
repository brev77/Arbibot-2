/**
 * Unit tests for PLAN14 #52/#53 pure logic. Run: node --test tools/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAS_UNITS_PER_SWAP, NET_PP_CLAMP_BPS,
  computeGasEth, median3, gasBpsUsd, computeNetPpBps,
  matchOpportunity, aggregateObservations,
  poolFeeBps, rawMarginalPriceUsd, feeAdjustedSpreadBps,
  decodeSwapAmounts, swapUsdFromEvent, isLargeSwap,
  hourlyCapAllows, cooldownAllows, rankEventCandidates,
  resolveLegPrice,
} from './probe-pp-core.mjs';

test('computeGasEth: calibrated receipt values (Arb 0.020 gwei, OP + L1)', () => {
  // Arb: 0.02 gwei × 150k = 3e-6 ETH (receipt measured 2.71e-6 for 135,586 gas — inside budget)
  const arb = computeGasEth({ gasPriceWei: 20_000_000n, l1FeeEth: null });
  assert.ok(Math.abs(arb - 0.000003) < 1e-12);
  // OP: 0.02 gwei × 150k + 1.7e-9 ETH L1
  const op = computeGasEth({ gasPriceWei: 20_000_000n, l1FeeEth: 1.7e-9 });
  assert.ok(Math.abs(op - 0.0000030017) < 1e-12);
  // degenerate
  assert.equal(computeGasEth({ gasPriceWei: 0n }), null);
});

test('median3: spike suppression (Arb 0.02 → 0.5 gwei spike must not kill a window)', () => {
  assert.equal(median3([1, 2, 3]), 2);
  assert.equal(median3([1, 2, 100]), 2);
  assert.equal(median3([5]), 5);
  assert.equal(median3([1, 2, 3, 4]), 3); // only last 3 count
  assert.equal(median3([]), null);
});

test('gasBpsUsd: $50 ≈ 0.8–4 bps band from the plan, $1000 ≤ 0.2 bps', () => {
  const bps50 = gasBpsUsd({ gasEth: 0.000003, ethUsd: 3500, notionalUsd: 50 });
  assert.ok(bps50 > 0 && bps50 <= 4.2, `got ${bps50}`);
  const bps1000 = gasBpsUsd({ gasEth: 0.000003, ethUsd: 3500, notionalUsd: 1000 });
  assert.ok(bps1000 <= 0.2, `got ${bps1000}`);
  assert.equal(gasBpsUsd({ gasEth: null, ethUsd: 3500, notionalUsd: 100 }), null);
});

test('computeNetPpBps: OVER-like row, gas included, no double-bridge subtraction', () => {
  // buy $100 → sell $100.63 (63 bps gross), gas 0.9 + 0.8 bps → net 61.3
  const r = computeNetPpBps({ usdIn: 100, usdOut: 100.63, gasBpsBuy: 0.9, gasBpsSell: 0.8 });
  assert.ok(Math.abs(r.netPpBps - 61.3) < 0.1);
  assert.equal(r.clamped, false);
});

test('computeNetPpBps: clamp at ±99999 keeps raw for diagnostics (lesson of 057)', () => {
  const r = computeNetPpBps({ usdIn: 100, usdOut: 100 + 100 * 25, gasBpsBuy: 0, gasBpsSell: 0 }); // +250000 bps
  assert.equal(r.netPpBps, NET_PP_CLAMP_BPS);
  assert.equal(r.raw, 250000);
  assert.equal(r.clamped, true);
  const n = computeNetPpBps({ usdIn: 100, usdOut: -2000 }); // −210000 bps → clamped
  assert.equal(n.netPpBps, -NET_PP_CLAMP_BPS);
  assert.equal(n.raw, -210000);
  assert.equal(computeNetPpBps({ usdIn: 0, usdOut: 1 }), null);
  assert.equal(GAS_UNITS_PER_SWAP, 150_000n);
});

test('matchOpportunity: open window within 30 min extends, beyond expires', () => {
  const win = { status: 'open', lastSeenMs: Date.parse('2026-08-18T10:00:00Z') };
  const within = { seenAtMs: Date.parse('2026-08-18T10:25:00Z') };
  const beyond = { seenAtMs: Date.parse('2026-08-18T10:35:00Z') };
  assert.equal(matchOpportunity(win, within, 30 * 60_000), true);
  assert.equal(matchOpportunity(win, beyond, 30 * 60_000), false);
  assert.equal(matchOpportunity({ status: 'expired', lastSeenMs: 0 }, within, 30 * 60_000), false);
});

test('aggregateObservations: multi-notional same route pre-aggregates (UPSERT-safe)', () => {
  const meta = { trust: 'heuristic', venue_pair: 'uniswap-v3:500>aerodrome-v2', gas_bps_buy: 0.9, gas_bps_sell: 0.8, token_tvl_buy_usd: 40000, token_tvl_sell_usd: 25000 };
  const rows = [
    { token: 'OVER', token_addr_buy_chain: '0xa', token_addr_sell_chain: '0xb', buy_chain_id: 10, sell_chain_id: 8453, notional_usd: 50, net_pp_bps: 40.1, bridge_fee_bps: null, metadata: meta, observed_at: '2026-08-18T10:00:00Z' },
    { token: 'OVER', token_addr_buy_chain: '0xa', token_addr_sell_chain: '0xb', buy_chain_id: 10, sell_chain_id: 8453, notional_usd: 100, net_pp_bps: 62.7, bridge_fee_bps: null, metadata: meta, observed_at: '2026-08-18T10:00:00Z' },
    { token: 'OVER', token_addr_buy_chain: '0xa', token_addr_sell_chain: '0xb', buy_chain_id: 10, sell_chain_id: 8453, notional_usd: 1000, net_pp_bps: -5, bridge_fee_bps: null, metadata: meta, observed_at: '2026-08-18T10:00:00Z' },
  ];
  const routes = aggregateObservations(rows);
  assert.equal(routes.length, 1);
  const rt = routes[0];
  assert.equal(rt.samples, 2);                    // $50 + $100, NOT 3 (1000 negative)
  assert.equal(rt.bestNetBps, 62.7);
  assert.equal(rt.bestNotionalUsd, 100);
  assert.equal(rt.maxNotionalPositive, 100);
  assert.equal(rt.at[50], 40.1);
  assert.equal(rt.gasBpsLast, 1.7);
  assert.equal(rt.venuePair, 'uniswap-v3:500>aerodrome-v2');
});

test('aggregateObservations: $1000-only positive never opens a window', () => {
  const rows = [
    { token: 'X', token_addr_buy_chain: '0xa', token_addr_sell_chain: '0xb', buy_chain_id: 10, sell_chain_id: 8453, notional_usd: 1000, net_pp_bps: 15, bridge_fee_bps: null, metadata: { trust: 'canonical' }, observed_at: '2026-08-18T10:00:00Z' },
  ];
  const routes = aggregateObservations(rows);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].opensWindow, false);     // depth-only route: recorded, no window
  assert.equal(routes[0].at[1000], 15);
});

test('aggregateObservations: negative threshold from config is honoured (−1000 smoke bug)', () => {
  const mk = (notional, net) => ({
    token: 'DUST', token_addr_buy_chain: '0xa', token_addr_sell_chain: '0xb',
    buy_chain_id: 10, sell_chain_id: 8453, notional_usd: notional, net_pp_bps: net,
    bridge_fee_bps: null, metadata: { trust: 'heuristic', venue_pair: 'x>y', gas_bps_buy: 1, gas_bps_sell: 1 }, observed_at: '2026-08-18T10:00:00Z',
  });
  // default threshold 0: negative rows are dropped → no window
  assert.equal(aggregateObservations([mk(50, -5), mk(100, -8)]).length, 0);
  // minNetBps = -1000 (smoke config): the same rows open a window
  const routes = aggregateObservations([mk(50, -5), mk(100, -8), mk(1000, -3)], { minNetBps: -1000 });
  assert.equal(routes.length, 1);
  assert.equal(routes[0].opensWindow, true);
  assert.equal(routes[0].samples, 2);
  assert.equal(routes[0].bestNetBps, -5); // least-negative is best
  assert.equal(routes[0].at[1000], -3);
});

test('poolFeeBps: v3 from registry, others conservative 30', () => {
  assert.equal(poolFeeBps('v3', 500), 5);
  assert.equal(poolFeeBps('v3', 3000), 30);
  assert.equal(poolFeeBps('v3', null), 30);
  assert.equal(poolFeeBps('v2'), 30);
  assert.equal(poolFeeBps('solidly-v2'), 30);
  assert.equal(poolFeeBps('algebra'), 30);
  assert.equal(poolFeeBps('slipstream', 100), 30); // registry carries tickSpacing, not fee
});

test('rawMarginalPriceUsd: reserves ratio + validity gates', () => {
  // 10 WETH-side units vs 30000 USDC-side units, 18/6 decimals → $3000
  const p = rawMarginalPriceUsd({ quoteReserveRaw: 30000n * 10n ** 6n, quoteDecimals: 6, tokenReserveRaw: 10n * 10n ** 18n, tokenDecimals: 18, quoteUsd: 1 });
  assert.ok(Math.abs(p - 3000) < 1e-9);
  assert.equal(rawMarginalPriceUsd({ quoteReserveRaw: 0n, quoteDecimals: 6, tokenReserveRaw: 1n, tokenDecimals: 18, quoteUsd: 1 }), null);
  assert.equal(rawMarginalPriceUsd({ quoteReserveRaw: 1n, quoteDecimals: 18, tokenReserveRaw: 1n, tokenDecimals: 18, quoteUsd: 1e15 }), null); // out of sane range
});

test('feeAdjustedSpreadBps: 1% vs 0.05% tier phantom killed (review №8)', () => {
  // raw prices identical (no dislocation), pools 1% vs 0.05% → phantom 95 bps
  const s = feeAdjustedSpreadBps({ buyPriceUsd: 1.0, sellPriceUsd: 1.0, feeBpsBuy: 100, feeBpsSell: 5 });
  assert.equal(s, -105); // no phantom trigger — deeply negative
  // real dislocation 60 bps on cheap pools survives fee adjustment
  const real = feeAdjustedSpreadBps({ buyPriceUsd: 1.0, sellPriceUsd: 1.006, feeBpsBuy: 5, feeBpsSell: 5 });
  assert.equal(real, 50);
  assert.equal(feeAdjustedSpreadBps({ buyPriceUsd: 0, sellPriceUsd: 1 }), null);
});

// ── #58 event triggers ─────────────────────────────────────────────────────────
const V3_TOPIC = '0x' + 'a'.repeat(64);
const V2_TOPIC = '0x' + 'b'.repeat(64);
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
// int256 two's complement for negatives (V3 amounts are signed)
const wordSigned = (n) => (n >= 0n ? word(n) : word((1n << 256n) + n));

test('decodeSwapAmounts: V3 signed legs → absolute movements, V2 In/Out summed', () => {
  // V3: 1500 USDC (6 dec) in as amount0=-1500e6, 0.4 WETH out as amount1=+0.4e18
  const v3 = decodeSwapAmounts(
    { topic0: V3_TOPIC, data: '0x' + wordSigned(-1500n * 10n ** 6n) + wordSigned(4n * 10n ** 17n) },
    { swapV3Topic: V3_TOPIC, swapV2Topic: V2_TOPIC },
  );
  assert.equal(v3.amount0, 1500n * 10n ** 6n);
  assert.equal(v3.amount1, 4n * 10n ** 17n);
  // V2: amount0In=0, amount1In=0.4e18, amount0Out=1500e6, amount1Out=0
  const v2 = decodeSwapAmounts(
    { topic0: V2_TOPIC, data: '0x' + word(0n) + word(4n * 10n ** 17n) + word(1500n * 10n ** 6n) + word(0n) },
    { swapV3Topic: V3_TOPIC, swapV2Topic: V2_TOPIC },
  );
  assert.equal(v2.amount0, 1500n * 10n ** 6n);
  assert.equal(v2.amount1, 4n * 10n ** 17n);
  // garbage: unknown topic, short data, non-hex
  assert.equal(decodeSwapAmounts({ topic0: '0xdead', data: '0x' + word(1n) }, { swapV3Topic: V3_TOPIC, swapV2Topic: V2_TOPIC }), null);
  assert.equal(decodeSwapAmounts({ topic0: V3_TOPIC, data: '0x1234' }, { swapV3Topic: V3_TOPIC, swapV2Topic: V2_TOPIC }), null);
});

test('swapUsdFromEvent: max over priced legs; no raw price → null (план: «нет цены → пропуск»)', () => {
  // both legs priced: 1500 USDC-side vs 0.4 WETH × $3300 = $1320 → max $1500
  const usd = swapUsdFromEvent({
    amount0: 1500n * 10n ** 6n, amount1: 4n * 10n ** 17n,
    price0: 1, price1: 3300, decimals0: 6, decimals1: 18,
  });
  assert.equal(usd, 1500);
  // only token1 priced (token0 = unlisted long-tail without raw price)
  const one = swapUsdFromEvent({
    amount0: 999n * 10n ** 18n, amount1: 4n * 10n ** 17n,
    price0: null, price1: 3300, decimals0: 18, decimals1: 18,
  });
  assert.equal(one, 1320);
  // neither priced → skip
  assert.equal(swapUsdFromEvent({ amount0: 1n, amount1: 1n, price0: null, price1: null, decimals0: 18, decimals1: 18 }), null);
});

test('isLargeSwap: threshold = max(minSwapUsd, depthFraction × depth) (DoD-5)', () => {
  // depth $10K → threshold max(500, 0.10×10000)=1000
  assert.equal(isLargeSwap({ swapUsd: 999, minSwapUsd: 500, depthFraction: 0.10, depthUsd: 10000 }), false);
  assert.equal(isLargeSwap({ swapUsd: 1000, minSwapUsd: 500, depthFraction: 0.10, depthUsd: 10000 }), true); // ≥ boundary
  assert.equal(isLargeSwap({ swapUsd: 1200, minSwapUsd: 500, depthFraction: 0.10, depthUsd: 10000 }), true);
  // thin pool $2K: threshold max(500, 200)=500 — the $500 floor dominates
  assert.equal(isLargeSwap({ swapUsd: 499, minSwapUsd: 500, depthFraction: 0.10, depthUsd: 2000 }), false);
  assert.equal(isLargeSwap({ swapUsd: 600, minSwapUsd: 500, depthFraction: 0.10, depthUsd: 2000 }), true);
  // no depth known → floor only
  assert.equal(isLargeSwap({ swapUsd: 500, minSwapUsd: 500, depthFraction: 0.10, depthUsd: null }), true);
  assert.equal(isLargeSwap({ swapUsd: null, minSwapUsd: 500, depthFraction: 0.10, depthUsd: 10000 }), false);
});

test('hourlyCapAllows: sliding window, burst of scam swaps cannot burn the budget (DoD-4)', () => {
  const now = Date.parse('2026-08-18T12:00:00Z');
  const cap = 3;
  // burst: 3 quotes in the trailing hour → 4th blocked
  let prior = [now - 60_000, now - 120_000, now - 600_000];
  assert.equal(hourlyCapAllows(prior, now, cap), false);
  // one slides OUT of the window (61 min old) → allowed again
  prior = [now - 3_660_000, now - 60_000, now - 120_000];
  assert.equal(hourlyCapAllows(prior, now, cap), true);
  // boundary: exactly 1h old does not count (strictly inside required)
  assert.equal(hourlyCapAllows([now - 3_600_000], now, cap), true);
  assert.equal(hourlyCapAllows([], now, cap), true);
  assert.equal(hourlyCapAllows([now], now, 0), false); // cap disabled
});

test('cooldownAllows: one token not more often than once per cooldownSec (DoD-4)', () => {
  const now = Date.parse('2026-08-18T12:00:00Z');
  assert.equal(cooldownAllows(null, now, 120), true); // never quoted
  assert.equal(cooldownAllows(now - 119_999, now, 120), false); // 119.999s — too soon
  assert.equal(cooldownAllows(now - 120_000, now, 120), true); // exactly 120s — allowed
});

test('rankEventCandidates: open windows → newborn → rest; bigger disturbance first (DoD priority)', () => {
  const ranked = rankEventCandidates([
    { token: 'AAA', swapUsd: 900, hasOpenWindow: false, newborn: false },
    { token: 'BBB', swapUsd: 700, hasOpenWindow: true, newborn: true },   // open wins over newborn
    { token: 'CCC', swapUsd: 800, hasOpenWindow: false, newborn: true },
    { token: 'DDD', swapUsd: 2000, hasOpenWindow: false, newborn: false },
  ]);
  assert.deepEqual(ranked.map((c) => c.token), ['BBB', 'CCC', 'DDD', 'AAA']);
  // within a tier: swapUsd desc
  const same = rankEventCandidates([
    { token: 'X', swapUsd: 100, hasOpenWindow: false, newborn: false },
    { token: 'Y', swapUsd: 300, hasOpenWindow: false, newborn: false },
  ]);
  assert.deepEqual(same.map((c) => c.token), ['Y', 'X']);
  // input not mutated
  const input = [{ token: 'X', swapUsd: 100, hasOpenWindow: false, newborn: false }, { token: 'Y', swapUsd: 300, hasOpenWindow: false, newborn: false }];
  rankEventCandidates(input);
  assert.equal(input[0].token, 'X');
});

test('resolveLegPrice: raw wins over garbage ladder (WSTETH fixture case, 🔴-1)', () => {
  // raw 2379 present → used even though the ladder is garbage 402
  const r = resolveLegPrice({ rawPriceUsd: 2379, ladderPriceUsd: 402, referenceUsd: 2381 });
  assert.equal(r.priceUsd, 2379);
  assert.equal(r.source, 'raw');
  assert.equal(r.rejected, false);
});

test('resolveLegPrice: ladder fallback — accepted within 300 bps of the reference', () => {
  // raw missing; ladder within 0.5% of reference → usable
  const ok = resolveLegPrice({ ladderPriceUsd: 100.5, referenceUsd: 100 });
  assert.equal(ok.priceUsd, 100.5);
  assert.equal(ok.source, 'ladder');
  // just under the 300 bps boundary → accepted; just over → rejected
  assert.equal(resolveLegPrice({ ladderPriceUsd: 102.9, referenceUsd: 100 }).rejected, false);
  assert.equal(resolveLegPrice({ ladderPriceUsd: 103.1, referenceUsd: 100 }).rejected, true);
});

test('resolveLegPrice: ladder contradicting the reference by >300 bps is rejected', () => {
  const bad = resolveLegPrice({ ladderPriceUsd: 402, referenceUsd: 2379 }); // −8310 bps
  assert.equal(bad.priceUsd, null);
  assert.equal(bad.rejected, true);
  assert.ok(bad.devBps > 8000);
  // no reference available → ladder accepted unchallenged (last resort)
  const noRef = resolveLegPrice({ ladderPriceUsd: 402 });
  assert.equal(noRef.priceUsd, 402);
  assert.equal(noRef.source, 'ladder');
});

test('resolveLegPrice: invalid inputs → null, never a fabricated price', () => {
  assert.equal(resolveLegPrice({}).priceUsd, null);                       // nothing available
  assert.equal(resolveLegPrice({ rawPriceUsd: 0 }).priceUsd, null);       // zero raw is not a price
  assert.equal(resolveLegPrice({ rawPriceUsd: 5e12, ladderPriceUsd: 5 }).priceUsd, 5); // insane raw ignored, ladder sane
  assert.equal(resolveLegPrice({ ladderPriceUsd: 3e12 }).priceUsd, null); // insane ladder rejected
});
