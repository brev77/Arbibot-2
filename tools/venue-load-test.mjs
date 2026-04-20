#!/usr/bin/env node
/**
 * Simple concurrent POST loop against HTTP venue `/v1/submit-leg` for adapter stress checks.
 *
 *   VENUE_HTTP_BASE_URL=http://127.0.0.1:9999 npm run venue:load-test
 *
 * Requires a running lab venue (`tools/lab-venue-stand.mjs`) or compatible mock.
 */
const base = process.env.VENUE_HTTP_BASE_URL?.replace(/\/+$/, '');
if (base === undefined || base.length === 0) {
  console.error('venue-load-test: set VENUE_HTTP_BASE_URL');
  process.exit(1);
}

const concurrent = Math.min(
  50,
  Math.max(1, Number.parseInt(process.env.VENUE_LOAD_CONCURRENCY ?? '5', 10) || 5),
);
const total = Math.max(
  concurrent,
  Number.parseInt(process.env.VENUE_LOAD_REQUESTS ?? '20', 10) || 20,
);

const url = `${base}/v1/submit-leg`;

async function one(i) {
  const body = {
    planId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    legId: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    legIndex: 0,
    submitIdempotencyKey: `loadtest:${i}`,
  };
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  return { status: res.status, ms };
}

let done = 0;
const queue = [];
for (let k = 0; k < total; k += 1) {
  queue.push(k);
}

async function worker() {
  while (queue.length > 0) {
    const i = queue.shift();
    if (i === undefined) {
      break;
    }
    const r = await one(i);
    done += 1;
    if (done % 10 === 0 || r.status >= 400) {
      console.log(
        `venue-load-test: ${done}/${total} status=${r.status} latencyMs=${r.ms}`,
      );
    }
  }
}

await Promise.all(Array.from({ length: concurrent }, () => worker()));
console.log(`venue-load-test: completed ${total} requests to ${url}`);
