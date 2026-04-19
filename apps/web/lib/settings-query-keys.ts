import { ConfigScopeType } from '@/lib/settings-types';

/** React Query keys for `/settings` (policy configurations). */
export const settingsQueryKeys = {
  configurations: (environment?: string, tenantId?: string) =>
    ['settings', 'configurations', environment ?? null, tenantId ?? null] as const,
  history: (configKey: string, scopeType: ConfigScopeType) =>
    ['settings', 'history', configKey, scopeType] as const,
};
