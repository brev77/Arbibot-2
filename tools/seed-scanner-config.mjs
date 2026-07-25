#!/usr/bin/env node
/**
 * Upsert `scanner.defaults` and `scanner.instances` via config-service HTTP API.
 *
 * Mirror of `tools/seed-intake-policy-config.mjs`. The values here match migration
 * `045_scanner_config_seed.sql` (the migration is the canonical seed on a fresh DB; this
 * script is the HTTP equivalent for an already-running config-service without re-running
 * migrations, e.g. to reset to defaults or to seed after the migration was skipped).
 *
 * Prerequisites: config-service listening (default http://127.0.0.1:3019).
 * If audit is unreachable, start config-service with AUDIT_CLIENT_ENABLED=false so POST/PUT succeed.
 *
 * Usage:
 *   CONFIG_API_BASE=http://127.0.0.1:3019 node tools/seed-scanner-config.mjs
 *   CONFIG_SEED_OPERATOR_ID=ops-alice node tools/seed-scanner-config.mjs
 */

const BASE = (
  process.env.CONFIG_API_BASE ??
  process.env.CONFIG_SERVICE_URL ??
  'http://127.0.0.1:3019'
).replace(/\/$/, '');

const OPERATOR_ID =
  process.env.CONFIG_SEED_OPERATOR_ID ?? 'seed-scanner-config-operator';

/**
 * Matches migration 045 + apps/web/lib/policy-config-registry.ts `scanner.defaults` zod schema.
 * Global fallback filters + RPC budget defaults + findings retention.
 */
const SCANNER_DEFAULTS = JSON.stringify({
  findingsRetentionDays: 7,
  rpcRateLimitRps: 10,
  poolCacheTtlMs: 30000,
  dedupCooldownMs: 60000,
  orphanRetryIntervalMs: 60000,
  orphanMaxAttempts: 5,
  opportunityPublishTimeoutMs: 5000,
  defaultFilters: {
    minSpreadBps: 30,
    minLiquidityUsd: 50000,
    volumeRange: { enabled: false, min1hUsd: 0, max24hUsd: 0 },
    blacklistTokens: [],
    allowedChains: [42161, 8453, 56],
    quoteAssets: ['WETH', 'USDC', 'USDT'],
  },
});

/**
 * Empty instances array by default — operators add real instance definitions (with pool
 * whitelists) via /settings or Hermes after deploy. Matches migration 045 seed shape.
 */
const SCANNER_INSTANCES = JSON.stringify({
  instances: [],
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
    // PUT may 404 if migration seeded the row but view scope differs;
    // fall back to POST (create) in that case.
    if (res.status === 404) {
      console.log(
        `PUT ${configKey} returned 404, falling back to POST (create)`,
      );
      const {
        res: postRes,
        body: postBody,
      } = await jsonFetch(`${BASE}/policy/configurations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          configKey,
          configValue,
          operatorId: OPERATOR_ID,
        }),
      });
      if (!postRes.ok) {
        throw new Error(
          `POST configurations ${configKey} (fallback): ${postRes.status} ${JSON.stringify(postBody)}`,
        );
      }
      console.log(`Created ${configKey} ok (fallback from PUT 404)`);
      return;
    }
    throw new Error(
      `PUT configurations ${configKey}: ${res.status} ${JSON.stringify(body)}`,
    );
  }
  console.log(`Updated ${configKey} ok`);
}

async function main() {
  await upsertConfig('scanner.defaults', SCANNER_DEFAULTS);
  await upsertConfig('scanner.instances', SCANNER_INSTANCES);
  console.log('seed-scanner-config: done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
