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
 */
export function aggregateObservations(rows, { openNotionals = [50, 100] } = {}) {
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
    if (net > 0 && openNotionals.includes(Number(row.notional_usd))) {
      rt.samples += 1;
      rt.opensWindow = true;
      rt.at[Number(row.notional_usd)] = net;
      if (rt.bestNetBps == null || net > rt.bestNetBps) {
        rt.bestNetBps = net;
        rt.bestNotionalUsd = Number(row.notional_usd);
      }
      rt.maxNotionalPositive = Math.max(rt.maxNotionalPositive ?? 0, Number(row.notional_usd));
      rt.gasBpsLast = Number(((meta.gas_bps_buy ?? 0) + (meta.gas_bps_sell ?? 0)).toFixed(2));
    } else if (Number(row.notional_usd) === 1000 && net > 0) {
      rt.at[1000] = net; // depth-only: recorded, never opens/extends
    }
  }
  return [...routes.values()].filter((rt) => rt.opensWindow || rt.at[1000] != null);
}
