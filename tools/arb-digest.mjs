#!/usr/bin/env node
/**
 * PLAN14 #53 — opportunity digest for the dry-run probe. SELECT-only, no RPC.
 * Prints open+expired windows for the requested period, grouped by token/route/
 * venue_pair, flags `unverified sell-side` (token with no dex-obs sell history —
 * honeypot risk), `skew-suspect` (best_net_bps < 5 bps — plausibly below the
 * intra-cycle leg-quote skew, review №2/№9) and canonical sanity breaches
 * (decision №3, non-blocking).
 *
 * Usage:
 *   node tools/arb-digest.mjs [--hours 24]
 *
 * Operator-run (by hand or via scheduler) — the bot itself never sends anything
 * («молчать, когда штатно»).
 */
import pg from 'pg';

const DB_URL = process.env.PROBE_DATABASE_URL ?? process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('PROBE_DATABASE_URL (or DATABASE_URL) is required.');
  process.exit(1);
}
const hours = (() => {
  const i = process.argv.indexOf('--hours');
  return i > 0 ? Math.max(1, Number(process.argv[i + 1]) || 24) : 24;
})();

const db = new pg.Pool({ connectionString: DB_URL, max: 2 });
db.on('error', (e) => console.error(`[pg pool] ${e.message}`));

const fmtBps = (x) => (x == null ? '—' : Number(x).toFixed(1));
const fmtUsd = (x) => (x == null ? '—' : `$${Number(x).toFixed(0)}`);

try {
  console.log(`# arb-digest — last ${hours}h (${new Date().toISOString()})`);

  // 1. Windows by lifecycle
  const life = await db.query(
    `SELECT status, COUNT(*) n,
            ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (COALESCE(expired_at, now()) - first_seen)))::numeric, 0) AS median_life_sec
       FROM dry_run_arb_opportunities
      WHERE first_seen > now() - make_interval(hours => $1)
      GROUP BY status`,
    [hours],
  );
  for (const row of life.rows) {
    console.log(`  ${row.status}: ${row.n} windows (median life ${row.median_life_sec}s)`);
  }

  // 2. Top windows (open first)
  const wins = await db.query(
    `SELECT o.token, o.buy_chain_id || '>' || o.sell_chain_id AS route, o.trust,
            o.status, o.best_net_bps, o.best_notional_usd, o.max_notional_positive,
            o.net_bps_at_50, o.net_bps_at_100, o.net_bps_at_1000,
            o.samples, o.venue_pair, o.first_seen, o.last_seen
       FROM dry_run_arb_opportunities o
      WHERE o.first_seen > now() - make_interval(hours => $1)
      ORDER BY (o.status = 'open') DESC, o.best_net_bps DESC
      LIMIT 25`,
    [hours],
  );
  if (wins.rows.length) {
    console.log('\n## Windows (top 25, open first):');
    for (const w of wins.rows) {
      const skew = Number(w.best_net_bps) < 5 ? ' ⚠skew-suspect' : '';
      const noSell = await db.query(
        `SELECT 1 FROM dry_run_dex_observations
          WHERE token_out = $1 AND chain_id = $2 AND observed_at > now() - interval '7 days'
          LIMIT 1`,
        [w.token, w.sell_chain_id],
      );
      const sell = noSell.rows.length ? '' : ' ⚠unverified-sell-side';
      console.log(
        `  ${w.token.padEnd(10)} ${w.route.padEnd(10)} ${w.status.padEnd(7)} best=${fmtBps(w.best_net_bps)}bps@$${Number(w.best_notional_usd).toFixed(0)}` +
        ` at50/100/1000=${fmtBps(w.net_bps_at_50)}/${fmtBps(w.net_bps_at_100)}/${fmtBps(w.net_bps_at_1000)}` +
        ` depth=${fmtUsd(w.max_notional_positive)} samples=${w.samples} trust=${w.trust}` +
        ` venue=${w.venue_pair ?? '—'}${skew}${sell}`,
      );
    }
  } else {
    console.log('\n## Windows: none (valid outcome — see FilterLab)');
  }

  // 3. Canonical sanity (decision №3): WETH/USDC at $50/$100 outside ±50 bps
  const sanity = await db.query(
    `SELECT token, buy_chain_id || '>' || sell_chain_id AS route, notional_usd, net_pp_bps
       FROM dry_run_cross_chain_observations
      WHERE observed_at > now() - make_interval(hours => $1)
        AND metadata->>'trust' = 'canonical'
        AND token IN ('WETH', 'USDC')
        AND notional_usd IN (50, 100)
        AND ABS(net_pp_bps) > 50
      ORDER BY ABS(net_pp_bps) DESC LIMIT 10`,
    [hours],
  );
  if (sanity.rows.length) {
    console.log('\n## [sanity] CANONICAL OFF-BAND alerts (non-blocking):');
    for (const s of sanity.rows) {
      console.log(`  ${s.token} ${s.route} $${Number(s.notional_usd).toFixed(0)}: ${fmtBps(s.net_pp_bps)} bps (±50 expected)`);
    }
  } else {
    console.log('\n## [sanity] canonical WETH/USDC within ±50 bps — OK');
  }
} catch (e) {
  console.error(`digest failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
