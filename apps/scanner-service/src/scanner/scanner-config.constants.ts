/**
 * Policy keys in config-service (single-writer = config-service; scanner only reads).
 * JSON value shapes mirror the zod schemas in apps/web/lib/policy-config-registry.ts
 * (scannerDefaultsSchema / scannerInstancesSchema) — keep them in sync.
 *
 * See docs/adr-scanner-service.md §3 (single-writer boundaries) and
 * docs/scanner-service-plan.md §1 (configuration ownership).
 */
export const SCANNER_DEFAULTS_POLICY_KEY = 'scanner.defaults';
export const SCANNER_INSTANCES_POLICY_KEY = 'scanner.instances';

/** Config-service scanner.* cache TTL (ms). Clamp to [5s, 300s]. See scanner-service-plan.md §3. */
export const DEFAULT_SCANNER_CONFIG_CACHE_TTL_MS = 30_000;
export const MIN_SCANNER_CONFIG_CACHE_TTL_MS = 5_000;
export const MAX_SCANNER_CONFIG_CACHE_TTL_MS = 300_000;

/** Default RPC rate limit (token bucket). Conservative — free public RPC ~50 req/min. */
export const DEFAULT_SCANNER_RPC_RATE_LIMIT_RPS = 10;

/** Default in-memory pool cache TTL (ms). */
export const DEFAULT_SCANNER_POOL_CACHE_TTL_MS = 30_000;

/** Default findings retention (days) — cleanup worker deletes older rows. */
export const DEFAULT_SCANNER_FINDINGS_RETENTION_DAYS = 7;

/** Default retention cleanup worker interval (ms) — hourly. */
export const DEFAULT_SCANNER_RETENTION_INTERVAL_MS = 60 * 60 * 1000;

/** Default dedup cooldown (ms) per (canonical_token, buy_venue, sell_venue). */
export const DEFAULT_SCANNER_DEDUP_COOLDOWN_MS = 60_000;

/** Default orphan publish retry interval (ms). */
export const DEFAULT_SCANNER_ORPHAN_RETRY_INTERVAL_MS = 60_000;

/** Max cumulative publish attempts before a finding is marked `failed`. */
export const DEFAULT_SCANNER_ORPHAN_MAX_ATTEMPTS = 5;

/** signedFetch timeout to opportunity-service (ms). */
export const DEFAULT_SCANNER_OPPORTUNITY_PUBLISH_TIMEOUT_MS = 5_000;

/** Floor for per-instance cycle interval (ms) — prevents tight-loop hammering. */
export const MIN_SCANNER_INSTANCE_INTERVAL_MS = 1_000;
