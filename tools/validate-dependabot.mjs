#!/usr/bin/env node
/**
 * Validate .github/dependabot.yml structure and billing-friendly properties.
 * Run: node tools/validate-dependabot.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import yaml from 'js-yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(root, '.github', 'dependabot.yml');

let doc;
try {
  doc = yaml.load(readFileSync(file, 'utf8'));
} catch (e) {
  console.error('❌ YAML PARSE ERROR:', e.message);
  process.exit(1);
}

if (doc.version !== 2) {
  console.error('❌ Expected version: 2, got:', doc.version);
  process.exit(1);
}

const updates = Array.isArray(doc.updates) ? doc.updates : [];
console.log('✅ Valid YAML v' + doc.version);
console.log('update-configs:', updates.length);

// Per-ecosystem breakdown
const ecos = {};
for (const u of updates) {
  ecos[u['package-ecosystem']] = (ecos[u['package-ecosystem']] || 0) + 1;
}
console.log('per-ecosystem:', JSON.stringify(ecos));

// Explicit day/time on every entry (spreads the load)
const missingTime = updates.filter((u) => !u.schedule || !u.schedule.day || !u.schedule.time);
console.log(
  missingTime.length === 0
    ? '✅ all entries have explicit day/time'
    : `⚠️ ${missingTime.length} entries missing explicit day/time`,
);

// rebase-strategy disabled on every entry (avoids CI re-runs)
const noRebase = updates.filter((u) => u['rebase-strategy'] !== 'disabled');
console.log(
  noRebase.length === 0
    ? '✅ all entries have rebase-strategy: disabled'
    : `⚠️ ${noRebase.length} entries without rebase-strategy=disabled`,
);

// Groups present
const grouped = updates.filter((u) => u.groups && Object.keys(u.groups).length > 0);
console.log(`groups: ${grouped.length}/${updates.length} entries`);

// Schedule distribution per (day, hour)
const slots = {};
for (const u of updates) {
  const key = `${u.schedule.day} ${u.schedule.time}`;
  slots[key] = (slots[key] || 0) + 1;
}
console.log('schedule distribution (UTC+3 / Europe/Moscow):');
for (const [slot, n] of Object.entries(slots).sort()) {
  const warn = n > 3 ? ' ⚠️ HIGH' : '';
  console.log(`  ${slot}: ${n} config(s)${warn}`);
}

// Max concurrency
const maxParallel = Math.max(...Object.values(slots));
console.log(
  maxParallel <= 3
    ? `✅ max parallel per hour = ${maxParallel} (billing-friendly)`
    : `⚠️ max parallel per hour = ${maxParallel} (consider spreading)`,
);

console.log('\n✔ dependabot.yml is structurally valid');