#!/usr/bin/env node
// Arbibot 2 — Seed canonical registry tables (venue_refs, canonical_instruments, canonical_routes)
//
// These tables are NOT auto-seeded by migrations. Run this script after migrations
// to populate the canonical market model for your deployment environment.
//
// Usage:
//   node tools/seed-canonical-registry.mjs
//
// Environment:
//   DATABASE_URL — Postgres connection string (required)
//   SEED_ENV     — "testnet" | "mainnet" (default: "testnet")
//
// The script is idempotent — uses ON CONFLICT DO NOTHING.

import { execSync } from 'node:child_process';

const DATABASE_URL = process.env.DATABASE_URL;
const SEED_ENV = process.env.SEED_ENV || 'testnet';

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is required');
  process.exit(1);
}

console.log(`Seeding canonical registry for environment: ${SEED_ENV}`);
console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);

function sql(query) {
  execSync(`psql "${DATABASE_URL}" -c "${query.replace(/"/g, '\\"')}"`, {
    stdio: 'inherit',
  });
}

function sqlFile(path) {
  execSync(`psql "${DATABASE_URL}" -f "${path}"`, { stdio: 'inherit' });
}

// ── Venue references ─────────────────────────────────────────
console.log('\n1. Seeding venue_refs...');

const venueRefs = [
  // format: key, name, type, adapter, is_active
  ['uniswap-v3-arb', 'Uniswap V3 (Arbitrum)', 'dex', 'uniswap-v3', true],
  ['sushiswap-arb', 'SushiSwap (Arbitrum)', 'dex', 'sushiswap', true],
  ['curve-arb', 'Curve (Arbitrum)', 'dex', 'curve', true],
  ['uniswap-v3-base', 'Uniswap V3 (Base)', 'dex', 'uniswap-v3', true],
  ['pancake-swap-bnb', 'PancakeSwap (BNB)', 'dex', 'pancakeswap', true],
  ['mock-venue', 'Mock Venue (Testing)', 'mock', 'mock', true],
];

for (const [key, name, type, adapter, isActive] of venueRefs) {
  sql(`
    INSERT INTO venue_refs (venue_key, venue_name, venue_type, adapter_type, is_active)
    VALUES ('${key}', '${name}', '${type}', '${adapter}', ${isActive})
    ON CONFLICT (venue_key) DO NOTHING;
  `);
}
console.log(`   Inserted ${venueRefs.length} venue refs`);

// ── Canonical instruments ─────────────────────────────────────
console.log('\n2. Seeding canonical_instruments...');

const instruments = [
  // format: instrument_key, base_asset, quote_asset, asset_class
  ['BTC-USDT', 'BTC', 'USDT', 'crypto'],
  ['ETH-USDT', 'ETH', 'USDT', 'crypto'],
  ['ETH-BTC', 'ETH', 'BTC', 'crypto'],
  ['SOL-USDT', 'SOL', 'USDT', 'crypto'],
  ['USDC-USDT', 'USDC', 'USDT', 'stablecoin'],
  ['WBTC-ETH', 'WBTC', 'ETH', 'crypto'],
];

for (const [key, base, quote, assetClass] of instruments) {
  sql(`
    INSERT INTO canonical_instruments (instrument_key, base_asset, quote_asset, asset_class, is_active)
    VALUES ('${key}', '${base}', '${quote}', '${assetClass}', true)
    ON CONFLICT (instrument_key) DO NOTHING;
  `);
}
console.log(`   Inserted ${instruments.length} canonical instruments`);

// ── Canonical routes ─────────────────────────────────────────
console.log('\n3. Seeding canonical_routes...');

const routes = [
  // format: route_key, buy_instrument_key, sell_instrument_key, buy_venue_key, sell_venue_key
  ['BTC-USDT-uniswap-sushi', 'BTC-USDT', 'BTC-USDT', 'uniswap-v3-arb', 'sushiswap-arb'],
  ['ETH-USDT-uniswap-curve', 'ETH-USDT', 'ETH-USDT', 'uniswap-v3-arb', 'curve-arb'],
  ['ETH-BTC-uniswap-sushi', 'ETH-BTC', 'ETH-BTC', 'uniswap-v3-arb', 'sushiswap-arb'],
  ['USDC-USDT-curve-uniswap', 'USDC-USDT', 'USDC-USDT', 'curve-arb', 'uniswap-v3-arb'],
  ['WBTC-ETH-uniswap-sushi', 'WBTC-ETH', 'WBTC-ETH', 'uniswap-v3-arb', 'sushiswap-arb'],
];

for (const [key, buyInstr, sellInstr, buyVenue, sellVenue] of routes) {
  sql(`
    INSERT INTO canonical_routes (route_key, buy_instrument_key, sell_instrument_key, buy_venue_key, sell_venue_key, is_active)
    VALUES ('${key}', '${buyInstr}', '${sellInstr}', '${buyVenue}', '${sellVenue}', true)
    ON CONFLICT (route_key) DO NOTHING;
  `);
}
console.log(`   Inserted ${routes.length} canonical routes`);

console.log('\n✅ Canonical registry seeded successfully.');
console.log('   Run `npm run db:verify-migrations:all` to verify DB state.');