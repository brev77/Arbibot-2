#!/usr/bin/env node
/**
 * Upsert `intake.throttling` and `intake.routing.tiers` via config-service HTTP API.
 *
 * Prerequisites: config-service listening (default http://127.0.0.1:3019).
 * If audit is unreachable, start config-service with AUDIT_CLIENT_ENABLED=false so POST/PUT succeed.
 *
 * Usage:
 *   CONFIG_API_BASE=http://127.0.0.1:3019 node tools/seed-intake-policy-config.mjs
 */

const BASE = (
  process.env.CONFIG_API_BASE ??
  process.env.CONFIG_SERVICE_URL ??
  'http://127.0.0.1:3019'
).replace(/\/$/, '');

const OPERATOR_ID =
  process.env.CONFIG_SEED_OPERATOR_ID ?? 'seed-intake-policy-operator';

/** Matches apps/market-intake-service/src/policy/policy-types.ts */
const INTAKE_THROTTLING = JSON.stringify({
  requireAuditOnThrottle: true,
  warmSampleIntervalMs: 2000,
  coldSampleIntervalMs: 30000,
  minRouteScore: 0,
});

const INTAKE_ROUTING_TIERS = JSON.stringify({
  hot: { enabled: true, instrumentKeys: ['BTC', 'ETH'] },
  warm: { enabled: true, instrumentKeys: ['SOL', 'AVAX'] },
  cold: { enabled: true, instrumentKeys: ['DOGE'] },
});

async function jsonFetch(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { res, body };
}

async function upsertConfig(configKey, configValue) {
  const listUrl = `${BASE}/policy/configurations`;
  const { res: listRes, body: listBody } = await jsonFetch(listUrl);
  if (!listRes.ok) {
    throw new Error(
      `GET ${listUrl} failed: ${listRes.status} ${JSON.stringify(listBody)}`,
    );
  }
  const rows = Array.isArray(listBody) ? listBody : [];
  const exists = rows.some((r) => r && r.configKey === configKey);

  if (!exists) {
    const { res, body } = await jsonFetch(`${BASE}/policy/configurations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configKey,
        configValue,
        operatorId: OPERATOR_ID,
      }),
    });
    if (!res.ok) {
      throw new Error(
        `POST configurations ${configKey}: ${res.status} ${JSON.stringify(body)}`,
      );
    }
    console.log(`Created ${configKey} ok`);
    return;
  }

  const { res, body } = await jsonFetch(
    `${BASE}/policy/configurations/${encodeURIComponent(configKey)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        configValue,
        operatorId: OPERATOR_ID,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      `PUT configurations ${configKey}: ${res.status} ${JSON.stringify(body)}`,
    );
  }
  console.log(`Updated ${configKey} ok`);
}

async function main() {
  await upsertConfig('intake.throttling', INTAKE_THROTTLING);
  await upsertConfig('intake.routing.tiers', INTAKE_ROUTING_TIERS);
  console.log('seed-intake-policy-config: done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
