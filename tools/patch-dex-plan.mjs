import { readFileSync, writeFileSync } from 'fs';

const f = '.cursor/plans/DEVELOPMENT_PLAN-DEX.md';
let c = readFileSync(f, 'utf8');
const lines = c.split('\n');

// Find the "Live testnet" section (line 1408) — it has wrong step_id PAPER-MAINNET, fix to LIVE-TESTNET
for (let i = 0; i < lines.length; i++) {
  // Fix heading: "Live testnet" section
  if (lines[i].includes('#### `DEX-1-3-PAPER-MAINNET`') && lines[i].includes('Live testnet')) {
    lines[i] = lines[i].replace('#### `DEX-1-3-PAPER-MAINNET`', '#### `DEX-1-3-LIVE-TESTNET`');
    console.log(`Line ${i}: Fixed heading → LIVE-TESTNET`);
  }
  // Fix step_id inside "Live testnet" section
  if (lines[i].includes('**step_id:** `DEX-1-3-PAPER-MAINNET`')) {
    // Check if this is within the "Live testnet" block (before "Mainnet paper" heading)
    // The second occurrence (Mainnet paper) should keep PAPER-MAINNET
    // The first occurrence (Live testnet) should become LIVE-TESTNET
    // We need to find which section we're in
    let foundLiveTestnet = false;
    for (let j = i - 1; j >= Math.max(0, i - 30); j--) {
      if (lines[j].includes('Live testnet')) {
        foundLiveTestnet = true;
        break;
      }
      if (lines[j].includes('Mainnet paper')) {
        break;
      }
    }
    if (foundLiveTestnet) {
      lines[i] = lines[i].replace('**step_id:** `DEX-1-3-PAPER-MAINNET`', '**step_id:** `DEX-1-3-LIVE-TESTNET`');
      console.log(`Line ${i}: Fixed step_id → LIVE-TESTNET`);
    }
  }
  // Fix status in the "Live testnet" section (status: planned → done)
  if (lines[i].includes('**status:** `planned`')) {
    let foundLiveTestnet = false;
    for (let j = i - 1; j >= Math.max(0, i - 30); j--) {
      if (lines[j].includes('DEX-1-3-LIVE-TESTNET') || lines[j].includes('Live testnet')) {
        foundLiveTestnet = true;
        break;
      }
      if (lines[j].includes('####') || lines[j].includes('Mainnet paper')) {
        break;
      }
    }
    if (foundLiveTestnet) {
      // Insert review notes before status line
      const reviewNotes = [
        '- **review_notes:**',
        '  - ✅ `tools/e2e-dex1-testnet.mjs` — E2E скрипт для testnet live DEX',
        '  - ✅ `docs/dex-testnet-runbook.md` — runbook для testnet live',
        '  - ✅ Полный цикл: reserve → arm → DEX ноги → settlement',
        '- **review_passed_date:** 2026-05-10',
      ];
      lines[i] = lines[i].replace('**status:** `planned`', '**status:** `done` ✅ (2026-05-10, session 18)');
      // Insert review notes before status line
      lines.splice(i, 0, ...reviewNotes);
      console.log(`Line ${i}: Fixed status → done, added review notes`);
      break; // Only fix the first match
    }
  }
}

// Add changelog v1.20 — find the last changelog entry and add after it
let changelogAdded = false;
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].includes('v1.19') && lines[i].includes('PAPER-TESTNET')) {
    const v120 = '- **v1.20** — 2026-05-10: `DEX-1-3-LIVE-TESTNET` → `done` ✅ (E2E testnet script `tools/e2e-dex1-testnet.mjs`; runbook `docs/dex-testnet-runbook.md`; full reserve→arm→DEX legs→settlement).';
    lines.splice(i + 1, 0, v120);
    console.log(`Line ${i}: Added v1.20 changelog after v1.19`);
    changelogAdded = true;
    break;
  }
}

if (!changelogAdded) {
  console.log('WARNING: v1.19 changelog not found, v1.20 not added');
}

writeFileSync(f, lines.join('\n'), 'utf8');
console.log('Done patching DEVELOPMENT_PLAN-DEX.md');