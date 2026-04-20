#!/usr/bin/env node
/**
 * Summarize or compare JSONL exports from export-route-scoring-history.mjs (P4-4-SCORE replay).
 *
 * Usage:
 *   node tools/replay-route-scoring-export.mjs summary [file.jsonl]   # reads stdin if file omitted
 *   node tools/replay-route-scoring-export.mjs compare <before.jsonl> <after.jsonl>
 *
 * Each JSON line: { routeKey, score, modelVersion, recordedAtIso, ... }
 */

import fs from 'node:fs';
import readline from 'node:readline';

/**
 * @param {string} path
 * @returns {AsyncGenerator<string, void, void>}
 */
async function* linesFromPath(path) {
  const stream = fs.createReadStream(path, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (t.length > 0) {
      yield t;
    }
  }
}

/**
 * @returns {AsyncGenerator<string, void, void>}
 */
async function* linesFromStdin() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (t.length > 0) {
      yield t;
    }
  }
}

/**
 * @param {string} line
 */
function parseRow(line) {
  const o = JSON.parse(line);
  if (typeof o.routeKey !== 'string' || o.routeKey.length === 0) {
    throw new Error('Invalid row: missing routeKey');
  }
  const score = Number(o.score);
  if (!Number.isFinite(score)) {
    throw new Error(`Invalid row: bad score for ${o.routeKey}`);
  }
  return {
    routeKey: o.routeKey,
    score,
    modelVersion: String(o.modelVersion ?? ''),
    recordedAtIso: String(o.recordedAtIso ?? ''),
  };
}

/**
 * @param {AsyncGenerator<string, void, void>} lineIterator
 * @returns {Promise<Map<string, { count: number, min: number, max: number, sum: number }>>}
 */
async function collectSummary(lineIterator) {
  /** @type {Map<string, { count: number, min: number, max: number, sum: number }>} */
  const byRoute = new Map();
  for await (const line of lineIterator) {
    const row = parseRow(line);
    const r = byRoute.get(row.routeKey) ?? {
      count: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
      sum: 0,
    };
    r.count += 1;
    r.min = Math.min(r.min, row.score);
    r.max = Math.max(r.max, row.score);
    r.sum += row.score;
    byRoute.set(row.routeKey, r);
  }
  return byRoute;
}

/**
 * Latest row per routeKey by recordedAtIso (ties keep last seen in file order).
 *
 * @param {AsyncGenerator<string, void, void>} lineIterator
 * @returns {Promise<Map<string, { score: number, modelVersion: string, recordedAtIso: string }>>}
 */
async function collectLatestPerRoute(lineIterator) {
  /** @type {Map<string, { score: number, modelVersion: string, recordedAtIso: string, t: number }>} */
  const latest = new Map();
  for await (const line of lineIterator) {
    const row = parseRow(line);
    const t = Date.parse(row.recordedAtIso);
    const ts = Number.isFinite(t) ? t : 0;
    const prev = latest.get(row.routeKey);
    if (!prev || ts >= prev.t) {
      latest.set(row.routeKey, {
        score: row.score,
        modelVersion: row.modelVersion,
        recordedAtIso: row.recordedAtIso,
        t: ts,
      });
    }
  }
  return latest;
}

/**
 * @param {Map<string, { score: number, modelVersion: string, recordedAtIso: string, t: number }>} m
 * @returns {Map<string, { score: number, modelVersion: string, recordedAtIso: string }>}
 */
function stripTime(m) {
  /** @type {Map<string, { score: number, modelVersion: string, recordedAtIso: string }>} */
  const out = new Map();
  for (const [k, v] of m) {
    out.set(k, { score: v.score, modelVersion: v.modelVersion, recordedAtIso: v.recordedAtIso });
  }
  return out;
}

async function main() {
  const [, , cmd, argA, argB] = process.argv;

  if (cmd === 'summary') {
    const iter = argA ? linesFromPath(argA) : linesFromStdin();
    const map = await collectSummary(iter);
    const routes = [...map.keys()].sort();
    console.log('routeKey\tcount\tmin\tmax\tmean');
    for (const rk of routes) {
      const s = map.get(rk);
      if (!s) {
        continue;
      }
      const mean = s.count > 0 ? s.sum / s.count : 0;
      console.log(
        `${rk}\t${s.count}\t${s.min}\t${s.max}\t${mean.toFixed(6)}`,
      );
    }
    return;
  }

  if (cmd === 'compare' && argA && argB) {
    const before = stripTime(await collectLatestPerRoute(linesFromPath(argA)));
    const after = stripTime(await collectLatestPerRoute(linesFromPath(argB)));
    const keys = new Set([...before.keys(), ...after.keys()]);
    const sorted = [...keys].sort();
    console.log('routeKey\tbefore\tafter\tdelta\tmodel_before\tmodel_after');
    for (const rk of sorted) {
      const x = before.get(rk);
      const y = after.get(rk);
      if (!x) {
        console.log(`${rk}\t-\t${y?.score}\t-\t-\t${y?.modelVersion ?? ''}`);
        continue;
      }
      if (!y) {
        console.log(`${rk}\t${x.score}\t-\t-\t${x.modelVersion}\t-`);
        continue;
      }
      const d = y.score - x.score;
      console.log(
        `${rk}\t${x.score}\t${y.score}\t${d.toFixed(6)}\t${x.modelVersion}\t${y.modelVersion}`,
      );
    }
    return;
  }

  console.error(`Usage:
  node tools/replay-route-scoring-export.mjs summary [file.jsonl]   # stdin if no file
  node tools/replay-route-scoring-export.mjs compare <before.jsonl> <after.jsonl>`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
