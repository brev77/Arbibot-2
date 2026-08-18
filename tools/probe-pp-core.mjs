/**
 * Pure logic for PLAN14 #52/#53 (probe exec_pp + opportunity windows).
 * No ethers, no pg, no network — everything here is unit-testable
 * (tools/probe-pp-core.test.mjs, `node --test tools/`).
 *
 * Gas model (calibrated 2026-08-17 against real swap receipts on Arb/Base/OP):
 *   one V3-style swap ≈ 110–140k gas L2; we budget 150k. L1 data-fee component
 *   is exact via GasPriceOracle.getL1Fee on Base/OP, negligible on Arbitrum
 *   (261 gas inside gasUsed). Model error ≤ ±20% → ≤ ±0.4 bps at $100 notional.
 */

export const GAS_UNITS_PER_SWAP = 150_000n;
export const NET_PP_CLAMP_BPS = 99999;

/** gasEth = gasPrice × 150k + l1Fee (all in ETH). */
export function computeGasEth({ gasPriceWei, l1FeeEth = null }) {
  if (gasPriceWei == null || gasPriceWei <= 0n) return null;
  const gasWei = gasPriceWei * GAS_UNITS_PER_SWAP;
  const l1Wei = l1FeeEth != null && l1FeeEth > 0 ? BigInt(Math.round(l1FeeEth * 1e18)) : 0n;
  return Number(gasWei + l1Wei) / 1e18;
}

/** Median of the current + up to 2 previous samples (spike suppression, review №A2). */
export function median3(history) {
  if (!history || history.length === 0) return null;
  const last = history.slice(-3).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (last.length === 0) return null;
  return last[Math.floor(last.length / 2)];
}

/** One swap leg gas cost in bps of the notional. */
export function gasBpsUsd({ gasEth, ethUsd, notionalUsd }) {
  if (gasEth == null || ethUsd == null || !notionalUsd || notionalUsd <= 0) return null;
  return (gasEth * ethUsd / notionalUsd) * 10000;
}

/**
 * exec_pp (#52): ((usdOut − usdIn)/usdIn)·10⁴ − gasBps(buy leg) − gasBps(sell leg),
 * clamped to ±99999; the pre-clamp value is returned as `raw` for diagnostics.
 */
export function computeNetPpBps({ usdIn, usdOut, gasBpsBuy = 0, gasBpsSell = 0 }) {
  if (!Number.isFinite(usdIn) || !Number.isFinite(usdOut) || usdIn <= 0) return null;
  const gross = ((usdOut - usdIn) / usdIn) * 10000;
  const raw = gross - (gasBpsBuy ?? 0) - (gasBpsSell ?? 0);
  const clamped = Math.max(-NET_PP_CLAMP_BPS, Math.min(NET_PP_CLAMP_BPS, raw));
  return { netPpBps: Number(clamped.toFixed(4)), raw: Number(raw.toFixed(4)), clamped: raw !== clamped };
}

// ── Raw tier (#57) ─────────────────────────────────────────────────────────────

/** Conservative pool fee in bps for the trigger math (review №8: fee-adjusted).
 *  v3 fee comes from the registry (fee millionths → bps); everything else
 *  (v2/solidly/algebra dynamic/slipstream — registry carries tickSpacing there,
 *  not fee) defaults to 30 bps until a per-pool source exists. */
export function poolFeeBps(poolType, feeMillionths = null) {
  if (poolType === 'v3' && feeMillionths != null && feeMillionths > 0) return feeMillionths / 100;
  return 30;
}

/** Marginal fee-free USD price from reserves. Validity gates (#57): both
 *  reserves > 0, finite price inside (1e-12, 1e9) — scam/dust fanтомы отсекаются. */
export function rawMarginalPriceUsd({ quoteReserveRaw, quoteDecimals, tokenReserveRaw, tokenDecimals, quoteUsd }) {
  if (!(quoteReserveRaw > 0n) || !(tokenReserveRaw > 0n) || !(quoteUsd > 0)) return null;
  const q = Number(quoteReserveRaw) / 10 ** quoteDecimals;
  const t = Number(tokenReserveRaw) / 10 ** tokenDecimals;
  if (!(q > 0) || !(t > 0)) return null;
  const p = (q / t) * quoteUsd;
  if (!Number.isFinite(p) || p <= 1e-12 || p >= 1e9) return null;
  return p;
}

/** Fee-adjusted cross-chain spread in bps (raw marginal, buy=cheap side).
 *  A 1% pool vs a 0.05% pool produces ~95 bps of PHANTOM spread — subtracting
 *  both pools' fees kills it before it can burn quote budget. */
export function feeAdjustedSpreadBps({ buyPriceUsd, sellPriceUsd, feeBpsBuy = 0, feeBpsSell = 0 }) {
  if (!(buyPriceUsd > 0) || !(sellPriceUsd > 0)) return null;
  const spread = ((sellPriceUsd / buyPriceUsd) - 1) * 10000 - (feeBpsBuy ?? 0) - (feeBpsSell ?? 0);
  if (!Number.isFinite(spread) || Math.abs(spread) >= 99999) return null;
  return Number(spread.toFixed(4));
}

/**
 * Window matcher (#53): does `obs` extend the OPEN window `existing`?
 * Mirrors the SQL UPSERT predicate (partial UNIQUE WHERE status='open' + 30-min gap).
 */
export function matchOpportunity(existing, obs, windowMs) {
  if (!existing || existing.status !== 'open') return false;
  return obs.seenAtMs - existing.lastSeenMs <= windowMs;
}

/**
 * Pre-aggregation for Stage 3 (#53, review №4): collapse one run's positive
 * observations into one record per route, so the UPSERT never hits
 * «cannot affect row a second time». Rows come from cc-obs with keys:
 * token, token_addr_buy_chain, token_addr_sell_chain, buy_chain_id, sell_chain_id,
 * notional_usd, net_pp_bps, bridge_fee_bps, metadata (object or JSON string).
 * Only notional 50/100 rows may open/extend windows; 1000 is depth-only.
 * `minNetBps` mirrors opportunity.minNetPpbps — the SQL SELECT and this
 * aggregation MUST share the threshold (the −1000 smoke caught them diverging:
 * SELECT passed negative rows, the hardcoded `net > 0` here dropped them).
 */
// ── Event triggers (#58) ──────────────────────────────────────────────────────

/** Decode a Swap event's data into per-token ABSOLUTE movement amounts (raw
 *  units). V3 (and algebra/slipstream — same event shape): amount0/amount1 are
 *  SIGNED int256, one negative (index side) one positive (output side) — take
 *  absolute values. V2 (and solidly-v2): amount{0,1}{In,Out} unsigned, exactly
 *  one of In/Out non-zero per side → movement = in + out. Topics are passed in
 *  (computed in probe-discovery) so this module stays ethers-free. */
export function decodeSwapAmounts({ topic0, data }, { swapV3Topic, swapV2Topic }) {
  if (typeof data !== 'string' || !data.startsWith('0x')) return null;
  const word = (i) => {
    const hex = data.slice(2 + i * 64, 2 + (i + 1) * 64);
    return hex.length === 64 ? BigInt(`0x${hex}`) : null;
  };
  if (topic0 === swapV3Topic) {
    const w0 = word(0), w1 = word(1);
    if (w0 == null || w1 == null) return null;
    // int256 two's complement → signed → absolute movement
    const abs = (x) => {
      const s = x >= 1n << 255n ? x - (1n << 256n) : x;
      return s < 0n ? -s : s;
    };
    return { amount0: abs(w0), amount1: abs(w1) };
  }
  if (topic0 === swapV2Topic) {
    const a0i = word(0), a1i = word(1), a0o = word(2), a1o = word(3);
    if (a0i == null || a1i == null || a0o == null || a1o == null) return null;
    return { amount0: a0i + a0o, amount1: a1i + a1o };
  }
  return null;
}

/** USD size of a swap event (#58): max over priced legs of |token movement| ×
 *  raw marginal price. Both legs are the same trade, so the priced leg sizes
 *  it; max() covers pools where one side has a raw price and the other doesn't.
 *  No price on either side → null (the plan's "нет цены → пропуск"). */
export function swapUsdFromEvent({ amount0, amount1, price0, price1, decimals0, decimals1 }) {
  const legs = [];
  if (amount0 != null && price0 != null && price0 > 0 && Number.isFinite(decimals0)) {
    legs.push((Math.abs(Number(amount0)) / 10 ** decimals0) * price0);
  }
  if (amount1 != null && price1 != null && price1 > 0 && Number.isFinite(decimals1)) {
    legs.push((Math.abs(Number(amount1)) / 10 ** decimals1) * price1);
  }
  if (legs.length === 0) return null;
  const usd = Math.max(...legs);
  return Number.isFinite(usd) && usd > 0 ? usd : null;
}

/** "Large" swap gate (#58): swapUsd ≥ max(minSwapUsd, depthFraction × depthUsd).
 *  A $500 floor alone would fire on every mid-size trade in a deep pool — the
 *  depth fraction keeps "large" relative to what the pool can absorb. */
export function isLargeSwap({ swapUsd, minSwapUsd, depthFraction, depthUsd = null }) {
  if (!(swapUsd > 0) || !(minSwapUsd > 0) || !(depthFraction > 0)) return false;
  const floor = Math.max(minSwapUsd, depthFraction * (depthUsd ?? 0));
  return swapUsd >= floor;
}

/** Sliding 1-hour event-quote cap (#58): a quote at nowMs is allowed while
 *  fewer than maxPerHour quotes sit strictly inside the trailing hour. */
export function hourlyCapAllows(priorQuoteMs, nowMs, maxPerHour) {
  if (!(maxPerHour > 0)) return false;
  const hourAgo = nowMs - 3_600_000;
  return priorQuoteMs.filter((t) => t > hourAgo).length < maxPerHour;
}

/** Per-token cooldown (#58): one token not more often than once per cooldownSec. */
export function cooldownAllows(lastQuotedMs, nowMs, cooldownSec) {
  if (lastQuotedMs == null) return true;
  return nowMs - lastQuotedMs >= cooldownSec * 1000;
}

/** Priority of an event-queue candidate (#58): open-window tokens quote first
 *  (defend live windows), then newborn pools (the dislocation habitat), then
 *  the rest; within a tier the bigger disturbance wins. Pure sort — mutates
 *  nothing, returns a new array. */
export function rankEventCandidates(list) {
  const tier = (c) => (c.hasOpenWindow ? 0 : c.newborn ? 1 : 2);
  return [...list].sort((a, b) => (tier(a) - tier(b)) || ((b.swapUsd ?? 0) - (a.swapUsd ?? 0)));
}

export function aggregateObservations(rows, { openNotionals = [50, 100], minNetBps = 0 } = {}) {
  const routes = new Map();
  for (const row of rows) {
    const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata ?? {});
    const key = `${row.token_addr_buy_chain}|${row.token_addr_sell_chain}|${row.buy_chain_id}|${row.sell_chain_id}`;
    if (!routes.has(key)) {
      routes.set(key, {
        token: row.token,
        tokenAddrBuy: row.token_addr_buy_chain,
        tokenAddrSell: row.token_addr_sell_chain,
        buyChainId: row.buy_chain_id,
        sellChainId: row.sell_chain_id,
        trust: meta.trust ?? 'heuristic',
        samples: 0,
        at: {}, // notional → net_pp_bps (last wins)
        bestNetBps: null,
        bestNotionalUsd: null,
        maxNotionalPositive: null,
        venuePair: meta.venue_pair ?? null,
        gasBpsLast: null,
        bridgeFeeBpsLast: row.bridge_fee_bps ?? null,
        tvlBuyUsdLast: meta.token_tvl_buy_usd ?? null,
        tvlSellUsdLast: meta.token_tvl_sell_usd ?? null,
        seenAt: row.observed_at ?? null,
        opensWindow: false,
      });
    }
    const rt = routes.get(key);
    const net = Number(row.net_pp_bps);
    if (net > minNetBps && openNotionals.includes(Number(row.notional_usd))) {
      rt.samples += 1;
      rt.opensWindow = true;
      rt.at[Number(row.notional_usd)] = net;
      if (rt.bestNetBps == null || net > rt.bestNetBps) {
        rt.bestNetBps = net;
        rt.bestNotionalUsd = Number(row.notional_usd);
      }
      rt.maxNotionalPositive = Math.max(rt.maxNotionalPositive ?? 0, Number(row.notional_usd));
      rt.gasBpsLast = Number(((meta.gas_bps_buy ?? 0) + (meta.gas_bps_sell ?? 0)).toFixed(2));
    } else if (Number(row.notional_usd) === 1000 && net > minNetBps) {
      rt.at[1000] = net; // depth-only: recorded, never opens/extends
    }
  }
  return [...routes.values()].filter((rt) => rt.opensWindow || rt.at[1000] != null);
}
