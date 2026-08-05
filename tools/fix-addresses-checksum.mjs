#!/usr/bin/env node
/**
 * One-shot address checksum normalizer for packages/contracts-eth/src/addresses/*.ts
 *
 * Background: 30+ addresses in the chain-address files had bad EIP-55 checksum
 * (mixed-case but wrong), which ethers v6 rejects with INVALID_ARGUMENT before
 * any RPC call. This caused the live trading pipeline to silently fail —
 * Chainlink price feed reads returned null, DEX pool reads returned null, etc.
 *
 * This script:
 *   1. Recalculates EIP-55 checksum for every address whose hex is valid but
 *      whose case is wrong (the common case — lowercase copy-paste).
 *   2. Replaces the known-corrupted Arbitrum chainlinkEthUsd with the correct
 *      mainnet Chainlink proxy address (sourced from Chainlink docs).
 *   3. Zeroes Arbitrum chainlinkUsdcUsd/UsdtUsd — both were corrupted (bad
 *      checksum + 41-char truncation), they are not consumed by PriceOracle v1
 *      (stables hard-coded to $1 via isStable()), and canonical addresses were
 *      not reachable via Chainlink's Vercel-protected API at fix time.
 *
 * Usage: node tools/fix-addresses-checksum.mjs
 * Run once; safe to re-run (idempotent on already-correct addresses).
 */
import { getAddress } from 'ethers';
import fs from 'node:fs';

const CHAINLINK_ETH_USD_ARBITRUM_CORRECT = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612';
const ZERO = '0x0000000000000000000000000000000000000000';

const files = [
  'packages/contracts-eth/src/addresses/arbitrum.ts',
  'packages/contracts-eth/src/addresses/base.ts',
  'packages/contracts-eth/src/addresses/bnb.ts',
  'packages/contracts-eth/src/addresses/optimism.ts',
];

const repoRoot = import.meta.dirname ? import.meta.dirname.replace(/[/\\]tools$/, '') : process.cwd();
let totalFixed = 0;

for (const relFile of files) {
  const file = `${repoRoot}/${relFile}`;
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');
  // Match lines like:  fieldName: '0x....',
  const matches = [...content.matchAll(/^(\s*)([a-zA-Z]+):\s+'(0x[a-fA-F0-9]+)',\s*$/gm)];
  let fileFixed = 0;
  let newContent = content;

  for (const m of matches) {
    const indent = m[1];
    const field = m[2];
    const addr = m[3];
    if (!addr.startsWith('0x')) continue;
    const hex = addr.substring(2);
    if (hex === '0'.repeat(40)) continue; // skip zero addresses

    // Already valid checksum?
    try {
      const checked = getAddress(addr);
      if (checked === addr) continue;
    } catch {
      // fall through to fix logic
    }

    let replacement = null;

    // Known corrupted Arbitrum Chainlink ETH/USD — replace with correct mainnet proxy.
    if (relFile.endsWith('arbitrum.ts') && field === 'chainlinkEthUsd') {
      replacement = CHAINLINK_ETH_USD_ARBITRUM_CORRECT;
    }
    // Corrupted Arbitrum USDC/USDT Chainlink (bad checksum + truncation).
    // Not consumed in v1 (stables → $1 via isStable()). Zero out until canonical
    // addresses are sourced from Chainlink docs.
    else if (relFile.endsWith('arbitrum.ts') && (field === 'chainlinkUsdcUsd' || field === 'chainlinkUsdtUsd')) {
      replacement = ZERO;
    }
    // General case: valid 40-hex, wrong checksum case → normalize.
    else if (hex.length === 40 && /^[0-9a-fA-F]+$/.test(hex)) {
      try {
        replacement = getAddress(`0x${hex.toLowerCase()}`);
      } catch (e) {
        console.error(`CANNOT FIX ${relFile} :: ${field} :: ${addr}: ${e.message}`);
        continue;
      }
    } else {
      console.error(`CORRUPTED ${relFile} :: ${field} :: ${addr} (manual review needed)`);
      continue;
    }

    if (replacement && replacement !== addr) {
      const old = `${indent}${field}: '${addr}',`;
      const neu = `${indent}${field}: '${replacement}',`;
      newContent = newContent.replace(old, neu);
      console.log(`FIX ${relFile.split('/').pop()} :: ${field}`);
      console.log(`     was: ${addr}`);
      console.log(`     now: ${replacement}`);
      fileFixed++;
      totalFixed++;
    }
  }

  if (fileFixed > 0) {
    fs.writeFileSync(file, newContent, 'utf8');
  }
}

console.log(`\n=== Total fixed: ${totalFixed} addresses ===`);
