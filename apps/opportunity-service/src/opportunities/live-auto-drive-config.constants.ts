/**
 * Policy key in config-service; JSON value — see docs/live-auto-drive-config-keys.md
 * (created in PLAN10). The LiveAutoDriveWorker reads `enabled` from this key
 * (env override: LIVE_AUTO_DRIVE_ENABLED).
 */
export const LIVE_AUTO_DRIVE_POLICY_KEY = 'live.auto_drive';

export const DEFAULT_LIVE_AUTO_DRIVE_CONFIG_CACHE_MS = 15_000;
