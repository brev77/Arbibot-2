#!/usr/bin/env node
/**
 * Minimal HTTP "venue lab" for {@link HttpVenueAdapter}: no real exchange, real TCP + JSON.
 * Used by `tools/ci-e2e-phase2.sh` and local experiments.
 * Max request body 64 KiB (413 if exceeded); dedupe by `submitIdempotencyKey` in POST JSON.
 *
 * Env: `LAB_VENUE_PORT` (default 3099), bind `127.0.0.1`.
 */

import http from 'node:http';

const port = Number.parseInt(process.env.LAB_VENUE_PORT ?? '3099', 10);
const MAX_BODY_BYTES = 64 * 1024;

/** @type {Map<string, string>} */
const idempotencyToExternalOrderId = new Map();

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === 'POST' && req.url === '/v1/submit-leg') {
    let raw = '';
    let aborted = false;
    req.on('data', (c) => {
      if (aborted) {
        return;
      }
      raw += c;
      if (raw.length > MAX_BODY_BYTES) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'payload_too_large' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (aborted) {
        return;
      }
      try {
        const correlationIn =
          typeof req.headers['x-correlation-id'] === 'string'
            ? req.headers['x-correlation-id'].trim()
            : '';
        const body = raw.length > 0 ? JSON.parse(raw) : {};
        const legIndex = body.legIndex;
        const legId = body.legId;
        if (typeof legId !== 'string' || typeof legIndex !== 'number') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'expected legId string and legIndex number' }));
          return;
        }
        const key =
          typeof body.submitIdempotencyKey === 'string' ? body.submitIdempotencyKey.trim() : '';
        const jsonHeaders = { 'Content-Type': 'application/json' };
        if (correlationIn.length > 0) {
          jsonHeaders['x-correlation-id'] = correlationIn;
        }
        if (key.length > 0) {
          const existing = idempotencyToExternalOrderId.get(key);
          if (existing !== undefined) {
            res.writeHead(200, jsonHeaders);
            res.end(JSON.stringify({ externalOrderId: existing }));
            return;
          }
        }
        const externalOrderId = `lab:${legId}:${legIndex}`;
        if (key.length > 0) {
          idempotencyToExternalOrderId.set(key, externalOrderId);
        }
        res.writeHead(200, jsonHeaders);
        res.end(JSON.stringify({ externalOrderId }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_json' }));
      }
    });
    return;
  }
  res.writeHead(404);
  res.end();
});

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console -- CLI
  console.log(`lab-venue-stand listening on http://127.0.0.1:${port}`);
});
