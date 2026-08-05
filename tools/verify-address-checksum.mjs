#!/usr/bin/env node
/**
 * Address checksum validator (CI helper).
 *
 * Reads every `0x…` address literal from packages/contracts-eth/src/addresses/*.ts
 * and asserts it passes ethers v6 EIP-55 checksum validation. Zero-address
 * (0x000…000) is exempted — it is a sentinel for "not deployed on this chain".
 *
 * Exit 1 on any violation. Run via `bash tools/ci-address-checksum.sh`.
 */
import { getAddress } from 'ethers';
import fs from 'node:fs';

const ZERO = '0x0000000000000000000000000000000000000000';
const repoRoot = import.meta.dirname ? import.meta.dirname.replace(/[/\\]tools$/, '') : process.cwd();
const files = [
  'packages/contracts-eth/src/addresses/arbitrum.ts',
  'packages/contracts-eth/src/addresses/base.ts',
  'packages/contracts-eth/src/addresses/bnb.ts',
  'packages/contracts-eth/src/addresses/optimism.ts',
];

let violations = 0;

for (const relFile of files) {
  const file = `${repoRoot}/${relFile}`;
  if (!fs.existsSync(file)) continue;
  const content = fs.readFileSync(file, 'utf8');
  const matches = [...content.matchAll(/^(\s*)([a-zA-Z]+):\s+'(0x[a-fA-F0-9]+)',\s*$/gm)];
  for (const m of matches) {
    const field = m[2];
    const addr = m[3];
    if (addr === ZERO) continue;
    try {
      const checked = getAddress(addr);
      if (checked !== addr) {
        console.error(`BAD CHECKSUM ${relFile} :: ${field}`);
        console.error(`  was: ${addr}`);
        console.error(`  fix: ${checked}`);
        violations++;
      }
    } catch (e) {
      console.error(`INVALID ADDRESS ${relFile} :: ${field} :: ${addr}`);
      console.error(`  error: ${e.message}`);
      violations++;
    }
  }
}

if (violations > 0) {
  console.error(`\n[ci-address-checksum] FAILED: ${violations} address(es) with bad checksum`);
  console.error('Run `node tools/fix-addresses-checksum.mjs` to auto-fix checksum-only issues.');
  process.exit(1);
}
console.log('[ci-address-checksum] OK: all addresses pass EIP-55 checksum');
