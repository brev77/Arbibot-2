/**
 * Policy key in config-service; JSON value — see docs/paper-auto-drive-config-keys.md.
 * The AutoDriveWorker reads `enabled` from this key (env override: PAPER_AUTO_DRIVE_ENABLED).
 */
export const PAPER_AUTO_DRIVE_POLICY_KEY = 'paper.auto_drive';

export const DEFAULT_PAPER_AUTO_DRIVE_CONFIG_CACHE_MS = 15_000;
