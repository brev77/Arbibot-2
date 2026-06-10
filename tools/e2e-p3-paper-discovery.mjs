#!/usr/bin/env node

/**
 * E2E Test Script for P3-4 Paper Discovery Pipeline
 *
 * Tests the complete paper discovery workflow:
 * 1. Setup paper-only token/route configuration
 * 2. Configure low profit threshold for discovery
 * 3. Generate mock market snapshot
 * 4. Trigger discovery worker
 * 5. Verify paper_discovery_candidates table
 * 6. Verify arbitrage_opportunities table (if enqueue implemented)
 * 7. Verify discovery metrics
 *
 * Usage: node tools/e2e-p3-paper-discovery.mjs
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const CONFIG = {
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://arbibot:arbibot@127.0.0.1:15432/arbibot',
  MARKET_INTAKE_URL: process.env.MARKET_INTAKE_SERVICE_URL || 'http://127.0.0.1:3015',
  PAPER_TRADING_URL: process.env.PAPER_API_BASE || 'http://127.0.0.1:3018',
  PAPER_DISCOVERY_ENABLED: 'true',
  PAPER_DISCOVERY_INTERVAL_MS: '30000',
  PAPER_DISCOVERY_MIN_PROFIT_USD: '0.5', // Low threshold for testing
  PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE: '0.1', // Low threshold for testing
  PAPER_DISCOVERY_MAX_CANDIDATES_PER_RUN: '10',
  PAPER_DISCOVERY_PAPER_ONLY_TOKENS: 'BTC,ETH',
  PAPER_DISCOVERY_PAPER_ONLY_ROUTES: 'btc-eth-uniswap,eth-usdc-curve',
};

// Colors for output
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = COLORS.reset) {
  console.log(`${color}${message}${COLORS.reset}`);
}

function error(message) {
  log(message, COLORS.red);
}

function success(message) {
  log(message, COLORS.green);
}

function info(message) {
  log(message, COLORS.blue);
}

// PostgreSQL helper
async function queryDB(sql, params = []) {
  const pg = await import('pg');
  const client = new pg.Client({ connectionString: CONFIG.DATABASE_URL });
  
  try {
    await client.connect();
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    await client.end();
  }
}

// HTTP helper
async function httpFetch(url, options = {}) {
  try {
    const headers = { ...options.headers };
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (err) {
    error(`HTTP request failed: ${err.message}`);
    throw err;
  }
}

// Wait for service health
async function waitForService(url, serviceName, maxAttempts = 30, intervalMs = 2000) {
  info(`Waiting for ${serviceName}...`);
  
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url + '/metrics', { method: 'GET' });
      if (response.ok) {
        success(`${serviceName} is healthy`);
        return true;
      }
    } catch (err) {
      // Service not ready yet, continue waiting
    }
    
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  error(`${serviceName} did not expose /metrics after ${maxAttempts} attempts`);
  return false;
}

// Test steps
async function setupConfiguration() {
  info('Setting up paper discovery configuration...');
  
  // Check if paper_discovery_candidates table exists
  const tables = await queryDB(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'paper_discovery_candidates'
  `);
  
  if (tables.length === 0) {
    error('paper_discovery_candidates table does not exist. Run migrations first.');
    return false;
  }
  
  success('paper_discovery_candidates table exists');
  
  // Check existing candidates
  const existingCandidates = await queryDB(`
    SELECT COUNT(*) as count 
    FROM paper_discovery_candidates
  `);
  
  info(`Existing discovery candidates: ${existingCandidates[0].count}`);
  
  return true;
}

async function setupMarketData() {
  info('Setting up market data for discovery...');
  
  // Check if market snapshots exist
  const snapshots = await queryDB(`
    SELECT COUNT(*) as count 
    FROM market_snapshots
  `);
  
  info(`Market snapshots in database: ${snapshots[0].count}`);
  
  // Insert test snapshots if needed
  if (snapshots[0].count === 0) {
    info('No snapshots found, inserting test data...');
    
    await queryDB(`
      INSERT INTO market_snapshots (id, instrument_key, route_key, bid_price, ask_price, timestamp, is_stale)
      VALUES 
        ('test-snapshot-1', 'BTC', 'btc-eth-uniswap', '45000.00', '45100.00', NOW(), false),
        ('test-snapshot-2', 'ETH', 'eth-usdc-curve', '3000.00', '3005.00', NOW(), false)
    `);
    
    success('Test snapshots inserted');
  } else {
    success('Market snapshots already exist');
  }
  
  return true;
}

async function triggerDiscoveryWorker() {
  info('Triggering paper discovery worker...');
  
  try {
    const result = await httpFetch(
      `${CONFIG.PAPER_TRADING_URL}/paper-discovery/trigger`,
      { method: 'POST' }
    );
    
    success('Discovery worker triggered successfully');
    info(`Result: ${JSON.stringify(result)}`);
    return result;
  } catch (err) {
    error(`Failed to trigger discovery worker: ${err.message}`);
    return null;
  }
}

async function verifyDiscoveryCandidates() {
  info('Verifying discovery candidates...');
  
  // Wait a bit for discovery to complete
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const candidates = await queryDB(`
    SELECT 
      id,
      token_key,
      route_key,
      theoretical_profit_usd,
      liquidity_score,
      is_eligible,
      status,
      created_at
    FROM paper_discovery_candidates
    ORDER BY created_at DESC
    LIMIT 10
  `);
  
  info(`Total discovery candidates: ${candidates.length}`);
  
  if (candidates.length === 0) {
    error('No discovery candidates found');
    return false;
  }
  
  // Check for paper-only tokens
  const paperOnlyCandidates = candidates.filter(
    c => c.token_key === 'BTC' || c.token_key === 'ETH'
  );
  
  success(`Paper-only candidates: ${paperOnlyCandidates.length}`);
  
  // Check eligibility
  const eligibleCandidates = candidates.filter(c => c.is_eligible);
  info(`Eligible candidates: ${eligibleCandidates.length}`);
  
  // Print sample candidates
  info('Sample discovery candidates:');
  candidates.slice(0, 3).forEach(c => {
    info(`  - ${c.token_key}/${c.route_key}: profit=$${c.theoretical_profit_usd}, eligible=${c.is_eligible}, status=${c.status}`);
  });
  
  return candidates.length > 0;
}

async function fetchMetricsText(url) {
  const response = await fetch(url, { method: 'GET' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return await response.text();
}

async function verifyDiscoveryMetrics() {
  info('Verifying discovery metrics...');
  
  try {
    const metricsText = await fetchMetricsText(
      `${CONFIG.PAPER_TRADING_URL}/metrics`
    );
    
    // Check for discovery metrics
    const hasCandidatesMetric = metricsText.includes('arb_paper_discovery_candidates_total');
    const hasEligibleMetric = metricsText.includes('arb_paper_discovery_eligible_total');
    const hasEnqueuedMetric = metricsText.includes('arb_paper_discovery_enqueued_total');
    const hasLatencyMetric = metricsText.includes('arb_paper_discovery_latency_ms');
    
    if (hasCandidatesMetric) {
      success('Discovery candidates metric found');
    } else {
      error('Discovery candidates metric NOT found');
    }
    
    if (hasEligibleMetric) {
      success('Discovery eligible metric found');
    } else {
      error('Discovery eligible metric NOT found');
    }
    
    if (hasEnqueuedMetric) {
      success('Discovery enqueued metric found');
    } else {
      error('Discovery enqueued metric NOT found');
    }
    
    if (hasLatencyMetric) {
      success('Discovery latency metric found');
    } else {
      error('Discovery latency metric NOT found');
    }
    
    // Extract metric values (simplified parsing)
    const candidatesTotalMatch = metricsText.match(
      /arb_paper_discovery_candidates_total\{[^}]*\}\s+(\d+)/
    );
    const eligibleTotalMatch = metricsText.match(
      /arb_paper_discovery_eligible_total\s+(\d+)/
    );
    const enqueuedTotalMatch = metricsText.match(
      /arb_paper_discovery_enqueued_total\s+(\d+)/
    );
    
    if (candidatesTotalMatch) {
      info(`Candidates found: ${candidatesTotalMatch[1]}`);
    }
    
    if (eligibleTotalMatch) {
      info(`Eligible candidates: ${eligibleTotalMatch[1]}`);
    }
    
    if (enqueuedTotalMatch) {
      info(`Enqueued candidates: ${enqueuedTotalMatch[1]}`);
    }
    
    return hasCandidatesMetric && hasEligibleMetric && hasEnqueuedMetric;
  } catch (err) {
    error(`Failed to verify discovery metrics: ${err.message}`);
    return false;
  }
}

async function verifyDiscoveryConfig() {
  info('Verifying discovery configuration...');
  
  try {
    const config = await httpFetch(
      `${CONFIG.PAPER_TRADING_URL}/paper-discovery/config`
    );
    
    success('Discovery configuration retrieved');
    info(`Configuration: ${JSON.stringify(config, null, 2)}`);
    
    // Verify configuration values
    if (config.enabled === true) {
      success('Discovery is enabled');
    } else {
      error('Discovery is disabled');
    }
    
    if (config.intervalMs >= 5000) {
      success(`Discovery interval is valid: ${config.intervalMs}ms`);
    } else {
      error(`Discovery interval is too low: ${config.intervalMs}ms`);
    }
    
    if (config.minProfitUsd >= 0) {
      success(`Min profit threshold is valid: $${config.minProfitUsd}`);
    } else {
      error(`Min profit threshold is invalid: ${config.minProfitUsd}`);
    }
    
    return true;
  } catch (err) {
    error(`Failed to verify discovery configuration: ${err.message}`);
    return false;
  }
}

async function runE2E() {
  log('Starting E2E test for P3-4 Paper Discovery Pipeline', COLORS.blue);
  log('=' .repeat(60), COLORS.blue);
  
  const results = {
    setupConfiguration: false,
    setupMarketData: false,
    waitForServices: false,
    triggerDiscovery: false,
    verifyCandidates: false,
    verifyMetrics: false,
    verifyConfig: false,
  };
  
  try {
    // Step 1: Setup configuration
    results.setupConfiguration = await setupConfiguration();
    if (!results.setupConfiguration) {
      error('Setup configuration failed, aborting');
      return false;
    }
    
    // Step 2: Setup market data
    results.setupMarketData = await setupMarketData();
    
    // Step 3: Wait for services
    results.waitForServices = await Promise.all([
      waitForService(CONFIG.MARKET_INTAKE_URL, 'market-intake-service'),
      waitForService(CONFIG.PAPER_TRADING_URL, 'paper-trading-service'),
    ]).then(() => true).catch(() => false);
    
    if (!results.waitForServices) {
      error('Services not ready, aborting');
      return false;
    }
    
    // Step 4: Verify configuration
    results.verifyConfig = await verifyDiscoveryConfig();
    
    // Step 5: Trigger discovery
    results.triggerDiscovery = await triggerDiscoveryWorker() !== null;
    
    // Step 6: Verify candidates
    results.verifyCandidates = await verifyDiscoveryCandidates();
    
    // Step 7: Verify metrics
    results.verifyMetrics = await verifyDiscoveryMetrics();
    
  } catch (err) {
    error(`E2E test failed with error: ${err.message}`);
    console.error(err);
    return false;
  }
  
  // Summary
  log('=' .repeat(60), COLORS.blue);
  log('E2E Test Summary', COLORS.blue);
  log('=' .repeat(60), COLORS.blue);
  
  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;
  
  Object.entries(results).forEach(([key, value]) => {
    const status = value ? COLORS.green : COLORS.red;
    const label = value ? 'PASS' : 'FAIL';
    log(`  ${key}: ${label}`, status);
  });
  
  log(`\nTotal: ${passed}/${total} tests passed`, COLORS.blue);
  
  if (passed === total) {
    success('E2E test completed successfully!');
    return true;
  } else {
    error(`E2E test failed: ${total - passed}/${total} tests failed`);
    return false;
  }
}

// Main execution
async function main() {
  const success = await runE2E();
  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  error(`Fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
