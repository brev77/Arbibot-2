'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { Button } from './ui/button';

import {
  ConfigurationDto,
  ConfigScopeType,
  ConfigurationStatus,
  CreateConfigurationDto,
  RollbackConfigurationDto,
  ConfigurationHistoryItemDto,
  PromoteConfigurationDto,
  UpdateConfigurationStatusDto,
} from '@/lib/settings-types';
import { settingsQueryKeys } from '@/lib/settings-query-keys';
import { DestructiveOperatorAction } from './destructive-operator-action';

interface SettingsWorkspaceProps {
  environment?: string;
  tenantId?: string;
}

type WatchlistTierRow = {
  instrumentKey: string;
  tier: string;
  reason: string;
  recordedAtIso: string;
};

const SENSITIVE_KEY = /^(risk\.|execution\.|capital\.)/;

async function fetchConfigurations(
  environment?: string,
  tenantId?: string,
): Promise<ConfigurationDto[]> {
  const params = new URLSearchParams();
  if (environment) params.append('environment', environment);
  if (tenantId) params.append('tenantId', tenantId);

  const response = await fetch(
    `/api/operator/settings/configurations?${params.toString()}`,
    { credentials: 'include' },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      (errorData as { error?: string }).error ||
        'Failed to load configurations',
    );
  }

  const data: unknown = await response.json();
  const list = Array.isArray(data)
    ? data
    : (data as { items?: ConfigurationDto[] }).items ?? [];
  return Array.isArray(list) ? list : [];
}

async function fetchHistory(configKey: string): Promise<ConfigurationHistoryItemDto[]> {
  const params = new URLSearchParams();
  params.append('scopeType', ConfigScopeType.GLOBAL);

  const response = await fetch(
    `/api/operator/settings/configurations/${encodeURIComponent(configKey)}/history?${params.toString()}`,
    { credentials: 'include' },
  );

  if (!response.ok) {
    throw new Error('Failed to load configuration history');
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

export function SettingsWorkspace({
  environment,
  tenantId,
}: SettingsWorkspaceProps) {
  const queryClient = useQueryClient();
  const [pageError, setPageError] = useState<string | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<ConfigurationDto | null>(
    null,
  );
  const [showHistory, setShowHistory] = useState(false);
  const [historyConfigKey, setHistoryConfigKey] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createKey, setCreateKey] = useState('');
  const [createValue, setCreateValue] = useState('');
  const [createSensitive, setCreateSensitive] = useState(false);
  const [createApproveReason, setCreateApproveReason] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ConfigurationDto | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editSensitive, setEditSensitive] = useState(false);
  const [editApproveReason, setEditApproveReason] = useState('');

  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<ConfigurationDto | null>(
    null,
  );
  const [rollbackVersion, setRollbackVersion] = useState('');
  const [rollbackApproveReason, setRollbackApproveReason] = useState('');

  const [createAsDraft, setCreateAsDraft] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteTarget, setPromoteTarget] = useState<ConfigurationDto | null>(
    null,
  );
  const [promoteToScopeType, setPromoteToScopeType] = useState<ConfigScopeType>(
    ConfigScopeType.ENVIRONMENT,
  );
  const [promoteToScopeValue, setPromoteToScopeValue] = useState('');
  const [promoteApproveReason, setPromoteApproveReason] = useState('');
  const [promoteIdempotencyKey, setPromoteIdempotencyKey] = useState('');
  const [activateDraftApproveReason, setActivateDraftApproveReason] =
    useState('');
  const [editSaveAsDraft, setEditSaveAsDraft] = useState(false);

  const [routeScoringKey, setRouteScoringKey] = useState('');
  const [routeScoringLoading, setRouteScoringLoading] = useState(false);
  const [routeScoringError, setRouteScoringError] = useState<string | null>(null);
  const [routeScoringRows, setRouteScoringRows] = useState<unknown[] | null>(
    null,
  );

  const [watchlistTiersLoading, setWatchlistTiersLoading] = useState(false);
  const [watchlistTiersError, setWatchlistTiersError] = useState<string | null>(
    null,
  );
  const [watchlistTierRows, setWatchlistTierRows] = useState<WatchlistTierRow[] | null>(
    null,
  );

  const [intakePolicyLoading, setIntakePolicyLoading] = useState(false);
  const [intakePolicyError, setIntakePolicyError] = useState<string | null>(null);
  const [intakeThrottlingJson, setIntakeThrottlingJson] = useState<string | null>(null);
  const [intakeTiersJson, setIntakeTiersJson] = useState<string | null>(null);

  const loadWatchlistTiers = useCallback(async () => {
    setWatchlistTiersLoading(true);
    setWatchlistTiersError(null);
    try {
      const res = await fetch('/api/operator/settings/watchlist-tiers', {
        credentials: 'include',
      });
      const body = (await res.json().catch(() => ({}))) as unknown;
      if (!res.ok) {
        const err = body as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const raw = body as { items?: unknown };
      const items: WatchlistTierRow[] = Array.isArray(raw.items)
        ? raw.items.filter(
            (r): r is WatchlistTierRow =>
              r !== null &&
              typeof r === 'object' &&
              'instrumentKey' in r &&
              'tier' in r &&
              'reason' in r &&
              'recordedAtIso' in r,
          )
        : [];
      setWatchlistTierRows(items);
    } catch (e) {
      setWatchlistTierRows(null);
      setWatchlistTiersError(
        e instanceof Error ? e.message : 'Failed to load watchlist tiers',
      );
    } finally {
      setWatchlistTiersLoading(false);
    }
  }, []);

  const loadIntakePolicyEffective = useCallback(async () => {
    setIntakePolicyLoading(true);
    setIntakePolicyError(null);
    try {
      const params = new URLSearchParams();
      if (environment) params.append('environment', environment);
      if (tenantId) params.append('tenantId', tenantId);
      const qs = params.toString() ? `?${params.toString()}` : '';

      const fetchEffective = async (key: string): Promise<string> => {
        const res = await fetch(
          `/api/operator/settings/configurations/${encodeURIComponent(key)}/effective${qs}`,
          { credentials: 'include' },
        );
        const body = (await res.json().catch(() => ({}))) as unknown;
        if (!res.ok) {
          const err = body as { error?: string; message?: string };
          throw new Error(
            err.error || err.message || `HTTP ${res.status} for ${key}`,
          );
        }
        const cv = (body as { configValue?: unknown }).configValue;
        if (typeof cv === 'string') {
          try {
            const parsed: unknown = JSON.parse(cv);
            return JSON.stringify(parsed, null, 2);
          } catch {
            return cv;
          }
        }
        return JSON.stringify(cv ?? body, null, 2);
      };

      const [th, ti] = await Promise.all([
        fetchEffective('intake.throttling'),
        fetchEffective('intake.routing.tiers'),
      ]);
      setIntakeThrottlingJson(th);
      setIntakeTiersJson(ti);
    } catch (e) {
      setIntakeThrottlingJson(null);
      setIntakeTiersJson(null);
      setIntakePolicyError(
        e instanceof Error ? e.message : 'Failed to load intake policy',
      );
    } finally {
      setIntakePolicyLoading(false);
    }
  }, [environment, tenantId]);

  const loadRouteScoring = useCallback(async () => {
    const key = routeScoringKey.trim();
    if (!key) {
      setRouteScoringError('Enter a route key');
      return;
    }
    setRouteScoringLoading(true);
    setRouteScoringError(null);
    try {
      const res = await fetch(
        `/api/operator/settings/route-scoring/${encodeURIComponent(key)}`,
        { credentials: 'include' },
      );
      const body = (await res.json().catch(() => ({}))) as unknown;
      if (!res.ok) {
        const err = body as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const rows = Array.isArray(body)
        ? body
        : body &&
            typeof body === 'object' &&
            body !== null &&
            'items' in body &&
            Array.isArray((body as { items?: unknown }).items)
          ? (body as { items: unknown[] }).items
          : [];
      setRouteScoringRows(rows);
    } catch (e) {
      setRouteScoringRows(null);
      setRouteScoringError(
        e instanceof Error ? e.message : 'Failed to load scoring history',
      );
    } finally {
      setRouteScoringLoading(false);
    }
  }, [routeScoringKey]);

  const listQuery = useQuery({
    queryKey: settingsQueryKeys.configurations(environment, tenantId),
    queryFn: () => fetchConfigurations(environment, tenantId),
    staleTime: 30_000,
  });

  const historyQuery = useQuery({
    queryKey:
      historyConfigKey != null
        ? settingsQueryKeys.history(historyConfigKey, ConfigScopeType.GLOBAL)
        : ['settings', 'history', 'noop'],
    queryFn: () => fetchHistory(historyConfigKey!),
    enabled: showHistory && historyConfigKey != null,
  });

  const invalidateConfigurations = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: settingsQueryKeys.configurations(environment, tenantId),
    });
  }, [queryClient, environment, tenantId]);

  const createMutation = useMutation({
    mutationFn: async (dto: CreateConfigurationDto) => {
      const response = await fetch('/api/operator/settings/configurations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(dto),
      });

      const data = (await response.json().catch(() => ({}))) as unknown;

      if (!response.ok) {
        const errorData = data as { error?: string; message?: string };
        throw new Error(
          errorData.error ||
            errorData.message ||
            'Failed to create configuration',
        );
      }
      return data as ConfigurationDto;
    },
    onSuccess: (data, variables) => {
      invalidateConfigurations();
      setCreateOpen(false);
      setCreateKey('');
      setCreateValue('');
      setCreateSensitive(false);
      setCreateApproveReason('');
      setCreateAsDraft(false);
      setPageError(null);
      if (variables.status === ConfigurationStatus.DRAFT && variables.configKey) {
        const key = variables.configKey;
        setHistoryConfigKey(key);
        setSelectedConfig(
          data && typeof data === 'object' && 'configKey' in data && data.configKey
            ? data
            : ({
                id: key,
                configKey: key,
                configValue: variables.configValue,
                isSensitive: variables.isSensitive ?? false,
                entityVersion: 1,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                updatedBy: null,
                scopeType: variables.scopeType ?? ConfigScopeType.GLOBAL,
                scopeValue: variables.scopeValue ?? null,
              } as ConfigurationDto),
        );
        setShowHistory(true);
        void queryClient.invalidateQueries({
          queryKey: settingsQueryKeys.history(key, ConfigScopeType.GLOBAL),
        });
      }
    },
    onError: (err: Error) => {
      setPageError(err.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (args: {
      configKey: string;
      body: Partial<CreateConfigurationDto>;
    }) => {
      const response = await fetch(
        `/api/operator/settings/configurations/${encodeURIComponent(args.configKey)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(args.body),
        },
      );

      const data = (await response.json().catch(() => ({}))) as unknown;

      if (!response.ok) {
        const errorData = data as { error?: string; message?: string };
        throw new Error(
          errorData.error || errorData.message || 'Failed to update configuration',
        );
      }
      return data;
    },
    onSuccess: (_data, variables) => {
      invalidateConfigurations();
      void queryClient.invalidateQueries({
        queryKey: ['settings', 'history'],
      });
      if (variables.body.status === ConfigurationStatus.DRAFT) {
        void queryClient.invalidateQueries({
          queryKey: settingsQueryKeys.history(
            variables.configKey,
            ConfigScopeType.GLOBAL,
          ),
        });
      }
      setEditOpen(false);
      setEditTarget(null);
      setEditSaveAsDraft(false);
      setPageError(null);
    },
    onError: (err: Error) => {
      setPageError(err.message);
    },
  });

  const rollbackMutation = useMutation({
    mutationFn: async (args: {
      configKey: string;
      body: RollbackConfigurationDto;
    }) => {
      const response = await fetch(
        `/api/operator/settings/configurations/${encodeURIComponent(args.configKey)}/rollback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(args.body),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          (errorData as { error?: string }).error ||
            'Failed to rollback configuration',
        );
      }
    },
    onSuccess: () => {
      invalidateConfigurations();
      void queryClient.invalidateQueries({
        queryKey: ['settings', 'history'],
      });
      setRollbackOpen(false);
      setRollbackTarget(null);
      setRollbackVersion('');
      setRollbackApproveReason('');
      setPageError(null);
    },
    onError: (err: Error) => {
      setPageError(err.message);
    },
  });

  const promoteMutation = useMutation({
    mutationFn: async (args: {
      configKey: string;
      body: PromoteConfigurationDto;
    }) => {
      const response = await fetch(
        `/api/operator/settings/configurations/${encodeURIComponent(args.configKey)}/promote`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(args.body),
        },
      );
      const data = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        const errorData = data as { error?: string; message?: string };
        throw new Error(
          errorData.message ||
            errorData.error ||
            'Failed to promote configuration',
        );
      }
      return data;
    },
    onSuccess: () => {
      invalidateConfigurations();
      void queryClient.invalidateQueries({
        queryKey: ['settings', 'history'],
      });
      setPromoteOpen(false);
      setPromoteTarget(null);
      setPromoteApproveReason('');
      setPageError(null);
    },
    onError: (err: Error) => {
      setPageError(err.message);
    },
  });

  const activateDraftMutation = useMutation({
    mutationFn: async (args: {
      configKey: string;
      body: UpdateConfigurationStatusDto;
    }) => {
      const response = await fetch(
        `/api/operator/settings/configurations/${encodeURIComponent(args.configKey)}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(args.body),
        },
      );
      const data = (await response.json().catch(() => ({}))) as unknown;
      if (!response.ok) {
        const errorData = data as { error?: string; message?: string };
        throw new Error(
          errorData.message ||
            errorData.error ||
            'Failed to activate draft configuration',
        );
      }
      return data;
    },
    onSuccess: () => {
      invalidateConfigurations();
      void queryClient.invalidateQueries({
        queryKey: ['settings', 'history'],
      });
      setActivateDraftApproveReason('');
      setPageError(null);
    },
    onError: (err: Error) => {
      setPageError(err.message);
    },
  });

  const openHistory = (config: ConfigurationDto) => {
    setSelectedConfig(config);
    setHistoryConfigKey(config.configKey);
    setShowHistory(true);
    setActivateDraftApproveReason('');
    setPageError(null);
  };

  const closeHistory = () => {
    setShowHistory(false);
    setHistoryConfigKey(null);
    setActivateDraftApproveReason('');
  };

  const openPromote = (config: ConfigurationDto) => {
    setPromoteTarget(config);
    setPromoteToScopeType(ConfigScopeType.ENVIRONMENT);
    setPromoteToScopeValue('');
    setPromoteApproveReason('');
    setPromoteIdempotencyKey(
      typeof globalThis.crypto !== 'undefined' &&
        typeof globalThis.crypto.randomUUID === 'function'
        ? globalThis.crypto.randomUUID()
        : `promote-${Date.now()}`,
    );
    setPromoteOpen(true);
    setPageError(null);
  };

  const submitCreate = async (): Promise<void> => {
    const needsApproval =
      createSensitive || SENSITIVE_KEY.test(createKey.trim());
    const dto: CreateConfigurationDto = {
      configKey: createKey.trim(),
      configValue: createValue,
      isSensitive: needsApproval,
      scopeType: ConfigScopeType.GLOBAL,
      status: createAsDraft ? ConfigurationStatus.DRAFT : ConfigurationStatus.ACTIVE,
      approveReason:
        needsApproval && createApproveReason.trim().length > 0
          ? createApproveReason.trim()
          : undefined,
    };
    if (needsApproval && !dto.approveReason) {
      throw new Error('Approval reason is required for sensitive keys.');
    }

    await createMutation.mutateAsync(dto);
  };

  const submitEdit = async (): Promise<void> => {
    if (!editTarget) return;
    const sensitive =
      editSensitive || SENSITIVE_KEY.test(editTarget.configKey);
    const dto: Partial<CreateConfigurationDto> = {
      configValue: editValue,
      isSensitive: sensitive,
      approveReason:
        sensitive && editApproveReason.trim().length > 0
          ? editApproveReason.trim()
          : undefined,
    };
    if (editSaveAsDraft) {
      dto.status = ConfigurationStatus.DRAFT;
    }
    if (sensitive && !dto.approveReason) {
      throw new Error('Approval reason is required for sensitive keys.');
    }

    await updateMutation.mutateAsync({
      configKey: editTarget.configKey,
      body: dto,
    });
  };

  const submitPromote = async (): Promise<void> => {
    if (!promoteTarget) return;
    const fromST = promoteTarget.scopeType;
    const fromSV = promoteTarget.scopeValue ?? null;
    const toST = promoteToScopeType;
    const toSV =
      toST === ConfigScopeType.GLOBAL
        ? null
        : promoteToScopeValue.trim() || null;
    if (toST !== ConfigScopeType.GLOBAL && !toSV) {
      throw new Error(
        'Target scope value is required when promoting to environment or tenant.',
      );
    }
    if (fromST === toST && fromSV === toSV) {
      throw new Error('Promotion requires a different target scope than the source.');
    }
    const key = promoteTarget.configKey;
    const sensitive = SENSITIVE_KEY.test(key);
    if (sensitive && !promoteApproveReason.trim()) {
      throw new Error('Approval reason is required for sensitive keys.');
    }
    const body: PromoteConfigurationDto = {
      fromScopeType: fromST,
      fromScopeValue: fromSV,
      toScopeType: toST,
      toScopeValue: toSV,
      idempotencyKey: promoteIdempotencyKey || undefined,
      approveReason: sensitive ? promoteApproveReason.trim() : undefined,
    };
    await promoteMutation.mutateAsync({ configKey: key, body });
  };

  const submitActivateDraft = async (): Promise<void> => {
    const key = historyConfigKey ?? selectedConfig?.configKey;
    if (!key) {
      throw new Error('No configuration key.');
    }
    const sensitive = SENSITIVE_KEY.test(key);
    if (sensitive && !activateDraftApproveReason.trim()) {
      throw new Error('Approval reason is required for sensitive keys.');
    }
    const body: UpdateConfigurationStatusDto = {
      status: ConfigurationStatus.ACTIVE,
      scopeType: ConfigScopeType.GLOBAL,
      scopeValue: null,
      approveReason: sensitive ? activateDraftApproveReason.trim() : undefined,
    };
    await activateDraftMutation.mutateAsync({ configKey: key, body });
  };

  const submitRollback = async (): Promise<void> => {
    if (!rollbackTarget) return;
    const toVersion = parseInt(rollbackVersion, 10);
    if (!Number.isFinite(toVersion) || toVersion < 1) {
      throw new Error('Invalid target version');
    }
    const sensitive = SENSITIVE_KEY.test(rollbackTarget.configKey);
    const dto: RollbackConfigurationDto = {
      toVersion,
      scopeType: ConfigScopeType.GLOBAL,
      isSensitive: sensitive,
      approveReason:
        sensitive && rollbackApproveReason.trim().length > 0
          ? rollbackApproveReason.trim()
          : undefined,
    };
    if (sensitive && !dto.approveReason) {
      throw new Error('Approval reason is required for sensitive keys.');
    }

    await rollbackMutation.mutateAsync({
      configKey: rollbackTarget.configKey,
      body: dto,
    });
  };

  const getRiskLevel = (configKey: string): 'high' | 'medium' | 'low' => {
    return SENSITIVE_KEY.test(configKey) ? 'high' : 'medium';
  };

  const configurations = listQuery.data ?? [];
  const loading = listQuery.isLoading;
  const error =
    pageError ||
    (listQuery.error instanceof Error
      ? listQuery.error.message
      : listQuery.error
        ? 'Failed to load configurations'
        : null);

  const history = historyQuery.data ?? [];
  const sortedHistory = [...history].sort(
    (a, b) => b.entityVersion - a.entityVersion,
  );
  const historyTip = sortedHistory[0];
  const canActivateDraft =
    Boolean(historyConfigKey) &&
    historyTip !== undefined &&
    !historyTip.isActive;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4">Policy Configurations</h2>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800">{error}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setPageError(null)}
              className="mt-2"
            >
              Dismiss
            </Button>
          </div>
        )}

        {loading ? (
          <div className="text-center py-8 text-slate-500">Loading…</div>
        ) : (
          <>
            <div className="mb-4 flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setCreateKey('');
                  setCreateValue('');
                  setCreateSensitive(false);
                  setCreateApproveReason('');
                  setCreateAsDraft(false);
                  setCreateOpen(true);
                }}
              >
                Create configuration
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Key
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Value
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Scope
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Version
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Sensitive
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Updated
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {configurations.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-8 text-center text-slate-500"
                      >
                        No configurations found
                      </td>
                    </tr>
                  ) : (
                    configurations.map((config) => (
                      <tr
                        key={config.id}
                        className="hover:bg-slate-50 cursor-pointer"
                        onClick={() => setSelectedConfig(config)}
                      >
                        <td className="px-4 py-3 text-sm font-medium text-slate-900">
                          {config.configKey}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 max-w-xs truncate">
                          {config.configValue}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium">
                            {config.scopeType === ConfigScopeType.GLOBAL && (
                              <span className="bg-blue-100 text-blue-800">
                                Global
                              </span>
                            )}
                            {config.scopeType ===
                              ConfigScopeType.ENVIRONMENT && (
                              <span className="bg-green-100 text-green-800">
                                {config.scopeValue || 'Environment'}
                              </span>
                            )}
                            {config.scopeType === ConfigScopeType.TENANT && (
                              <span className="bg-purple-100 text-purple-800">
                                {config.scopeValue || 'Tenant'}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          v{config.entityVersion}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {config.isSensitive ? (
                            <span className="text-red-600 font-medium">Yes</span>
                          ) : (
                            <span className="text-slate-400">No</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {new Date(config.updatedAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-sm space-x-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              openHistory(config);
                            }}
                          >
                            History
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditTarget(config);
                              setEditValue(config.configValue);
                              setEditSensitive(config.isSensitive);
                              setEditApproveReason('');
                              setEditSaveAsDraft(false);
                              setEditOpen(true);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              openPromote(config);
                            }}
                          >
                            Promote
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRollbackTarget(config);
                              setRollbackVersion(
                                String(Math.max(1, config.entityVersion - 1)),
                              );
                              setRollbackApproveReason('');
                              setRollbackOpen(true);
                            }}
                          >
                            Rollback
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="border-t border-slate-200 pt-6 html.theme-light:border-slate-200">
        <h2 className="text-xl font-semibold mb-2">Watchlist tiers (latest per instrument)</h2>
        <p className="text-sm text-slate-500 mb-4">
          Read-only: risk-service{' '}
          <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">
            GET /policy/watchlist/tiers
          </code>
          . Shows the latest tier snapshot per instrument (Phase 2.2 writers / Phase 4 prep).
        </p>
        <div className="flex flex-wrap gap-2 items-end mb-4">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void loadWatchlistTiers()}
            disabled={watchlistTiersLoading}
          >
            {watchlistTiersLoading ? 'Loading…' : 'Load tiers'}
          </Button>
        </div>
        {watchlistTiersError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
            {watchlistTiersError}
          </div>
        )}
        {watchlistTierRows !== null && (
          <div className="border rounded-lg overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">
                    Instrument
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">
                    Tier
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">
                    Reason
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">
                    Recorded (UTC)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {watchlistTierRows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-slate-500" colSpan={4}>
                      No tier snapshots yet
                    </td>
                  </tr>
                ) : (
                  watchlistTierRows.map((row) => (
                    <tr key={`${row.instrumentKey}-${row.recordedAtIso}`}>
                      <td className="px-3 py-2 font-mono text-xs break-all">
                        {row.instrumentKey}
                      </td>
                      <td className="px-3 py-2">{row.tier}</td>
                      <td className="px-3 py-2 text-xs">{row.reason}</td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                        {row.recordedAtIso}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 pt-6 html.theme-light:border-slate-200">
        <h2 className="text-xl font-semibold mb-2">Intake policy (effective)</h2>
        <p className="text-sm text-slate-500 mb-4">
          Read-only: config-service{' '}
          <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">
            GET /policy/configurations/.../effective
          </code>{' '}
          for keys{' '}
          <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">intake.throttling</code> and{' '}
          <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">intake.routing.tiers</code>. Keys
          are documented in repo file <code className="text-xs">docs/intake-policy-config-keys.md</code>.
        </p>
        <div className="flex flex-wrap gap-2 items-end mb-4">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void loadIntakePolicyEffective()}
            disabled={intakePolicyLoading}
          >
            {intakePolicyLoading ? 'Loading…' : 'Load intake policy'}
          </Button>
        </div>
        {intakePolicyError && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
            {intakePolicyError}
          </div>
        )}
        {intakeThrottlingJson !== null && (
          <div className="mb-6">
            <h3 className="text-sm font-medium text-slate-700 mb-2">intake.throttling</h3>
            <pre className="text-xs bg-slate-50 border rounded p-3 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-all">
              {intakeThrottlingJson}
            </pre>
          </div>
        )}
        {intakeTiersJson !== null && (
          <div className="mb-2">
            <h3 className="text-sm font-medium text-slate-700 mb-2">intake.routing.tiers</h3>
            <pre className="text-xs bg-slate-50 border rounded p-3 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-all">
              {intakeTiersJson}
            </pre>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 pt-6 html.theme-light:border-slate-200">
        <h2 className="text-xl font-semibold mb-2">Route scoring history</h2>
        <p className="text-sm text-slate-500 mb-4">
          Read-only: risk-service{' '}
          <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">
            GET /policy/route-scoring-history/:routeKey
          </code>
          . Enter a canonical route key to inspect stored score versions.
        </p>
        <div className="flex flex-wrap gap-2 items-end mb-4">
          <label className="block text-sm text-slate-700 min-w-[200px] flex-1">
            Route key
            <input
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={routeScoringKey}
              onChange={(e) => setRouteScoringKey(e.target.value)}
              placeholder="e.g. venueA:PAIR:venueB"
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void loadRouteScoring()}
            disabled={routeScoringLoading}
          >
            {routeScoringLoading ? 'Loading…' : 'Load history'}
          </Button>
        </div>
        {routeScoringError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
            {routeScoringError}
          </div>
        )}
        {routeScoringRows !== null && (
          <div className="border rounded-lg overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-600">
                    Row (JSON)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {routeScoringRows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-6 text-slate-500">No rows yet</td>
                  </tr>
                ) : (
                  routeScoringRows.map((row, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">
                        {JSON.stringify(row)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="max-w-md w-full rounded-lg border border-slate-800 bg-slate-950 p-6 shadow-xl html.theme-light:border-slate-200 html.theme-light:bg-white">
            <h3 className="text-lg font-semibold text-slate-100 html.theme-light:text-slate-900">
              New configuration
            </h3>
            <div className="mt-4 space-y-3">
              <label className="block text-sm text-slate-300 html.theme-light:text-slate-700">
                Key
                <input
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
                  value={createKey}
                  onChange={(e) => setCreateKey(e.target.value)}
                />
              </label>
              <label className="block text-sm text-slate-300 html.theme-light:text-slate-700">
                Value
                <textarea
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
                  rows={3}
                  value={createValue}
                  onChange={(e) => setCreateValue(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300 html.theme-light:text-slate-700">
                <input
                  type="checkbox"
                  checked={createAsDraft}
                  onChange={(e) => setCreateAsDraft(e.target.checked)}
                />
                Save as draft (inactive until activated from History)
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300 html.theme-light:text-slate-700">
                <input
                  type="checkbox"
                  checked={createSensitive}
                  onChange={(e) => setCreateSensitive(e.target.checked)}
                />
                Sensitive (requires approval reason)
              </label>
              {(createSensitive || SENSITIVE_KEY.test(createKey)) && (
                <label className="block text-sm text-slate-300 html.theme-light:text-slate-700">
                  Approval reason
                  <input
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
                    value={createApproveReason}
                    onChange={(e) => setCreateApproveReason(e.target.value)}
                  />
                </label>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <DestructiveOperatorAction
                actionLabel="Save"
                level={
                  createSensitive || SENSITIVE_KEY.test(createKey)
                    ? 'high'
                    : 'medium'
                }
                requireTypedConfirmPhrase={
                  createSensitive || SENSITIVE_KEY.test(createKey)
                    ? 'APPROVE'
                    : undefined
                }
                impactPreview={{
                  affectedResources: createKey || '(new key)',
                  potentialConsequences:
                    'Creates a new policy row visible to all services that read this configuration.',
                }}
                onConfirm={submitCreate}
                disabled={
                  createKey.trim().length === 0 ||
                  createValue.length === 0 ||
                  createMutation.isPending
                }
              />
            </div>
          </div>
        </div>
      )}

      {editOpen && editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="max-w-md w-full rounded-lg border border-slate-800 bg-slate-950 p-6 shadow-xl html.theme-light:border-slate-200 html.theme-light:bg-white">
            <h3 className="text-lg font-semibold text-slate-100 html.theme-light:text-slate-900">
              Edit {editTarget.configKey}
            </h3>
            <div className="mt-4 space-y-3">
              <label className="block text-sm text-slate-300 html.theme-light:text-slate-700">
                Value
                <textarea
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
                  rows={3}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300 html.theme-light:text-slate-700">
                <input
                  type="checkbox"
                  checked={editSensitive}
                  onChange={(e) => setEditSensitive(e.target.checked)}
                />
                Treat as sensitive change
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300 html.theme-light:text-slate-700">
                <input
                  type="checkbox"
                  checked={editSaveAsDraft}
                  onChange={(e) => setEditSaveAsDraft(e.target.checked)}
                />
                Save as draft (new inactive version; activate from History)
              </label>
              {(editSensitive || SENSITIVE_KEY.test(editTarget.configKey)) && (
                <label className="block text-sm text-slate-300 html.theme-light:text-slate-700">
                  Approval reason
                  <input
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
                    value={editApproveReason}
                    onChange={(e) => setEditApproveReason(e.target.value)}
                  />
                </label>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditOpen(false);
                  setEditSaveAsDraft(false);
                }}
              >
                Cancel
              </Button>
              <DestructiveOperatorAction
                actionLabel="Apply update"
                level={getRiskLevel(editTarget.configKey)}
                requireTypedConfirmPhrase={
                  getRiskLevel(editTarget.configKey) === 'high'
                    ? 'APPROVE'
                    : undefined
                }
                impactPreview={{
                  affectedResources: editTarget.configKey,
                  potentialConsequences: editSaveAsDraft
                    ? 'Adds a new draft row; active value stays until you activate the draft.'
                    : 'Writes a new configuration version; consumers may pick it up after cache TTL.',
                }}
                onConfirm={submitEdit}
                disabled={
                  (editValue === editTarget.configValue && !editSaveAsDraft) ||
                  updateMutation.isPending
                }
              />
            </div>
          </div>
        </div>
      )}

      {rollbackOpen && rollbackTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="max-w-md w-full rounded-lg border border-slate-800 bg-slate-950 p-6 shadow-xl html.theme-light:border-slate-200 html.theme-light:bg-white">
            <h3 className="text-lg font-semibold text-slate-100 html.theme-light:text-slate-900">
              Rollback {rollbackTarget.configKey}
            </h3>
            <div className="mt-4 space-y-3">
              <label className="block text-sm text-slate-300 html.theme-light:text-slate-700">
                Target version
                <input
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
                  value={rollbackVersion}
                  onChange={(e) => setRollbackVersion(e.target.value)}
                />
              </label>
              {SENSITIVE_KEY.test(rollbackTarget.configKey) && (
                <label className="block text-sm text-slate-300 html.theme-light:text-slate-700">
                  Approval reason
                  <input
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
                    value={rollbackApproveReason}
                    onChange={(e) => setRollbackApproveReason(e.target.value)}
                  />
                </label>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRollbackOpen(false)}
              >
                Cancel
              </Button>
              <DestructiveOperatorAction
                actionLabel="Rollback"
                level={getRiskLevel(rollbackTarget.configKey)}
                requireTypedConfirmPhrase={
                  getRiskLevel(rollbackTarget.configKey) === 'high'
                    ? 'APPROVE'
                    : undefined
                }
                impactPreview={{
                  affectedResources: rollbackTarget.configKey,
                  potentialConsequences:
                    'Restores an older active version for operators and automation.',
                }}
                onConfirm={submitRollback}
                disabled={
                  rollbackVersion.trim().length === 0 || rollbackMutation.isPending
                }
              />
            </div>
          </div>
        </div>
      )}

      {promoteOpen && promoteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="max-w-md w-full rounded-lg border border-slate-800 bg-slate-950 p-6 shadow-xl html.theme-light:border-slate-200 html.theme-light:bg-white">
            <h3 className="text-lg font-semibold text-slate-100 html.theme-light:text-slate-900">
              Promote {promoteTarget.configKey}
            </h3>
            <p className="mt-2 text-sm text-slate-400 html.theme-light:text-slate-600">
              From{' '}
              <strong>
                {promoteTarget.scopeType}
                {promoteTarget.scopeValue
                  ? ` / ${promoteTarget.scopeValue}`
                  : ''}
              </strong>{' '}
              to a new scope. Target must be empty for that key.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm text-slate-300 html.theme-light:text-slate-700">
                Target scope type
                <select
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
                  value={promoteToScopeType}
                  onChange={(e) =>
                    setPromoteToScopeType(e.target.value as ConfigScopeType)
                  }
                >
                  <option value={ConfigScopeType.GLOBAL}>global</option>
                  <option value={ConfigScopeType.ENVIRONMENT}>environment</option>
                  <option value={ConfigScopeType.TENANT}>tenant</option>
                </select>
              </label>
              {promoteToScopeType !== ConfigScopeType.GLOBAL && (
                <label className="block text-sm text-slate-300 html.theme-light:text-slate-700">
                  Target scope value (e.g. env name or tenant id)
                  <input
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
                    value={promoteToScopeValue}
                    onChange={(e) => setPromoteToScopeValue(e.target.value)}
                    placeholder={
                      promoteToScopeType === ConfigScopeType.ENVIRONMENT
                        ? 'staging'
                        : 'tenant-id'
                    }
                  />
                </label>
              )}
              {SENSITIVE_KEY.test(promoteTarget.configKey) && (
                <label className="block text-sm text-slate-300 html.theme-light:text-slate-700">
                  Approval reason
                  <input
                    className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
                    value={promoteApproveReason}
                    onChange={(e) => setPromoteApproveReason(e.target.value)}
                  />
                </label>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPromoteOpen(false);
                  setPromoteTarget(null);
                }}
              >
                Cancel
              </Button>
              <DestructiveOperatorAction
                actionLabel="Promote"
                level={getRiskLevel(promoteTarget.configKey)}
                requireTypedConfirmPhrase={
                  getRiskLevel(promoteTarget.configKey) === 'high'
                    ? 'APPROVE'
                    : undefined
                }
                impactPreview={{
                  affectedResources: promoteTarget.configKey,
                  potentialConsequences:
                    'Copies the active value into the target scope and deactivates the source row.',
                }}
                onConfirm={submitPromote}
                disabled={
                  promoteMutation.isPending ||
                  (promoteToScopeType !== ConfigScopeType.GLOBAL &&
                    promoteToScopeValue.trim().length === 0)
                }
              />
            </div>
          </div>
        </div>
      )}

      {showHistory && selectedConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="max-w-4xl w-full rounded-lg border border-slate-800 bg-slate-950 p-6 shadow-xl max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">
              Configuration History: {selectedConfig.configKey}
            </h3>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => closeHistory()}
              >
                Close
              </Button>
            </div>
            {canActivateDraft && !historyQuery.isLoading && !historyQuery.isError && (
              <div className="mb-4 p-4 rounded-lg border border-amber-200 bg-amber-50 html.theme-light:bg-amber-50">
                <p className="text-sm text-amber-950 mb-3">
                  The latest version is a <strong>draft</strong> (inactive).
                  Activate it to apply this value as the active configuration for
                  this scope.
                </p>
                {historyConfigKey &&
                  SENSITIVE_KEY.test(historyConfigKey) && (
                    <label className="block text-sm text-slate-800 mb-3">
                      Approval reason
                      <input
                        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                        value={activateDraftApproveReason}
                        onChange={(e) =>
                          setActivateDraftApproveReason(e.target.value)
                        }
                      />
                    </label>
                  )}
                <DestructiveOperatorAction
                  actionLabel="Activate draft"
                  level={
                    historyConfigKey &&
                    SENSITIVE_KEY.test(historyConfigKey)
                      ? 'high'
                      : 'medium'
                  }
                  requireTypedConfirmPhrase={
                    historyConfigKey &&
                    SENSITIVE_KEY.test(historyConfigKey)
                      ? 'APPROVE'
                      : undefined
                  }
                  impactPreview={{
                    affectedResources: selectedConfig.configKey,
                    potentialConsequences:
                      'Replaces the current active version with this draft (new active row).',
                  }}
                  onConfirm={submitActivateDraft}
                  disabled={activateDraftMutation.isPending}
                />
              </div>
            )}
            {historyQuery.isLoading ? (
              <div className="text-center py-8 text-slate-500">Loading history…</div>
            ) : historyQuery.isError ? (
              <div className="text-center py-8 text-red-600">
                Failed to load history
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        Version
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        Value
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        Sensitive
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        Created At
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        Updated By
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase">
                        Active
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {history.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-4 py-8 text-center text-slate-500"
                        >
                          No history found
                        </td>
                      </tr>
                    ) : (
                      history.map((item) => (
                        <tr key={item.id}>
                          <td className="px-4 py-3 text-sm font-medium text-slate-900">
                            v{item.entityVersion}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600 max-w-xs truncate">
                            {item.configValue}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {item.isSensitive ? (
                              <span className="text-red-600 font-medium">Yes</span>
                            ) : (
                              <span className="text-slate-400">No</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {new Date(item.createdAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {item.updatedBy || '-'}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {item.isActive ? (
                              <span className="text-green-600 font-medium">Yes</span>
                            ) : (
                              <span className="text-slate-400">No</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
