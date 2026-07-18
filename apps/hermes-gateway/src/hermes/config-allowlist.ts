import { ForbiddenException } from '@nestjs/common';

/**
 * Allowlist of config-key patterns Hermes is allowed to MUTATE via Telegram.
 *
 * Decision: docs/adr-hermes-config-management.md (Plan 6, H6-A-1).
 *
 * Sensitive keys (`risk.*`, `execution.*`, `capital.*`) are operator-UI-only:
 * Hermes may READ them (read-only is non-destructive) but must never change
 * them. The gateway enforces this boundary BEFORE forwarding to config-service
 * so the LLM cannot bypass it even if the external agent misbehaves.
 *
 * The allowlist mirrors the non-sensitive half of
 * `apps/web/lib/policy-config-registry.ts` + the `SENSITIVE_KEYS_PATTERN`
 * (`^(risk\..*|execution\..*|capital\..*)`) in config-service.
 */
export const ALLOWED_CONFIG_KEY_PATTERNS: ReadonlyArray<RegExp> = [
  /^intake\./,
  /^paper\./,
  /^opportunity\./,
  /^dex\./,
  /^features\./,
];

/**
 * Explicit blocklist for a clear, Russian error message.
 * (These would already be rejected by the allowlist not matching, but the
 * explicit list produces a more helpful 403 body for the operator.)
 */
export const BLOCKED_CONFIG_KEY_PATTERNS: ReadonlyArray<RegExp> = [
  /^risk\./,
  /^execution\./,
  /^capital\./,
];

/** True if `configKey` matches any allowlist pattern. */
export function isConfigKeyAllowed(configKey: string): boolean {
  return ALLOWED_CONFIG_KEY_PATTERNS.some((re) => re.test(configKey));
}

/**
 * Assert that Hermes may mutate this config key. Throws `ForbiddenException`
 * (HTTP 403) with a Russian message directing the operator to the UI when the
 * key is sensitive or otherwise outside the allowlist.
 */
export function assertConfigKeyAllowed(configKey: string): void {
  if (isConfigKeyAllowed(configKey)) {
    return;
  }
  const sensitive = BLOCKED_CONFIG_KEY_PATTERNS.some((re) => re.test(configKey));
  const reason = sensitive
    ? `Hermes не может менять sensitive-ключ «${configKey}» (risk/execution/capital). Используйте UI /settings.`
    : `Hermes не может менять ключ «${configKey}» — нет в allowlist (intake/paper/opportunity/dex/features).`;
  throw new ForbiddenException({ error: 'CONFIG_KEY_NOT_ALLOWED', message: reason });
}
