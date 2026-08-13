-- Analysis queries for the multi-chain dry-run probe.
-- Run after at least 24h of observation for representative p50/p95 percentiles.
-- Usage:
--   psql "$DATABASE_URL" -f tools/probe-analysis.sql
--   psql "$DATABASE_URL" -f tools/probe-analysis.sql -v hours=48
--   psql "$DATABASE_URL" -c "$(cat tools/probe-analysis.sql)" # if -f not supported
--
-- All queries are read-only.

\set hours 24
\echo === Observation window: :hours hours ===
\echo
\echo === Phase 1: cross-DEX round-trip distribution per chain ===
SELECT
  chain_id,
  COUNT(*)                                                          AS total,
  COUNT(*) FILTER (WHERE round_trip_bps > 0)                        AS n_positive,
  COUNT(*) FILTER (WHERE round_trip_bps > 30)                       AS n_positive_after_30bps_fees,
  ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY round_trip_bps)::numeric, 2) AS p50_bps,
  ROUND(PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY round_trip_bps)::numeric, 2) AS p90_bps,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY round_trip_bps)::numeric, 2) AS p95_bps,
  ROUND(MAX(round_trip_bps)::numeric, 2)                            AS max_bps
FROM dry_run_dex_observations
WHERE observed_at > NOW() - (:hours || ' hours')::INTERVAL
GROUP BY chain_id
ORDER BY chain_id;

\echo
\echo === Top cross-DEX opportunities by avg round-trip bps (any positive signal?) ===
SELECT
  chain_id,
  token_in || '/' || token_out                       AS pair,
  buy_venue || ' → ' || sell_venue                   AS route,
  notional_usd,
  ROUND(AVG(round_trip_bps)::numeric, 2)             AS avg_bps,
  ROUND(MAX(round_trip_bps)::numeric, 2)             AS max_bps,
  COUNT(*)                                           AS samples,
  COUNT(*) FILTER (WHERE round_trip_bps > 30)        AS n_clears_30bps_fee_drag
FROM dry_run_dex_observations
WHERE observed_at > NOW() - (:hours || ' hours')::INTERVAL
GROUP BY chain_id, pair, route, notional_usd
HAVING AVG(round_trip_bps) > 0
ORDER BY avg_bps DESC
LIMIT 25;

\echo
\echo === Notional sensitivity: where does the edge die? ===
SELECT
  chain_id,
  notional_usd,
  ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY round_trip_bps)::numeric, 2) AS p50_bps,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY round_trip_bps)::numeric, 2) AS p95_bps,
  COUNT(*) FILTER (WHERE round_trip_bps > 0) AS n_positive
FROM dry_run_dex_observations
WHERE observed_at > NOW() - (:hours || ' hours')::INTERVAL
GROUP BY chain_id, notional_usd
ORDER BY chain_id, notional_usd;

\echo
\echo === Temporal stability: are positive signals persistent or sporadic? ===
SELECT
  date_trunc('hour', observed_at) AS hour,
  chain_id,
  COUNT(*) FILTER (WHERE round_trip_bps > 30) AS n_opps_clearing_30bps
FROM dry_run_dex_observations
WHERE observed_at > NOW() - (:hours || ' hours')::INTERVAL
GROUP BY 1, 2
ORDER BY 1 DESC, 2;

\echo
\echo === Phase 2: cross-chain price-gap distribution (no bridge fee subtraction) ===
SELECT
  token,
  buy_chain_id || '→' || sell_chain_id               AS route,
  notional_usd,
  ROUND(AVG(price_diff_bps)::numeric, 2)             AS avg_diff_bps,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY price_diff_bps)::numeric, 2) AS p95_diff_bps,
  ROUND(MAX(price_diff_bps)::numeric, 2)             AS max_diff_bps,
  COUNT(*)                                           AS samples
FROM dry_run_cross_chain_observations
WHERE observed_at > NOW() - (:hours || ' hours')::INTERVAL
GROUP BY token, route, notional_usd
ORDER BY avg_diff_bps DESC
LIMIT 25;

\echo
\echo === Phase 2 net-of-bridge-fee edge (only populated if ACROSS_API_KEY was set) ===
SELECT
  token,
  buy_chain_id || '→' || sell_chain_id AS route,
  bridge_protocol,
  ROUND(AVG(price_diff_bps)::numeric, 2)  AS avg_price_diff_bps,
  ROUND(AVG(bridge_fee_bps)::numeric, 2)  AS avg_bridge_fee_bps,
  ROUND(AVG(net_edge_bps)::numeric, 2)    AS avg_net_edge_bps,
  COUNT(*) FILTER (WHERE net_edge_bps > 0) AS n_positive_net_edge,
  COUNT(*)                                AS samples
FROM dry_run_cross_chain_observations
WHERE observed_at > NOW() - (:hours || ' hours')::INTERVAL
  AND bridge_fee_bps IS NOT NULL
GROUP BY token, route, bridge_protocol
ORDER BY avg_net_edge_bps DESC;

\echo
\echo === Bridge-fee-less sanity check ===
\echo If bridge_fee_bps is NULL everywhere, the next query shows the avg gap to compare manually.
\echo Reference (from research 2026-08-12): Across ~5–7 bps L2-L2, Stargate ~10 bps, Hop ~15–19 bps.
\echo If avg price_diff_bps below < 6 → cross-chain is structurally dead at this universe.
SELECT
  token,
  buy_chain_id || '→' || sell_chain_id AS route,
  ROUND(AVG(price_diff_bps)::numeric, 2) AS avg_gap_bps,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY price_diff_bps)::numeric, 2) AS p95_gap_bps,
  COUNT(*) AS samples
FROM dry_run_cross_chain_observations
WHERE observed_at > NOW() - (:hours || ' hours')::INTERVAL
GROUP BY token, route
ORDER BY avg_gap_bps DESC;
