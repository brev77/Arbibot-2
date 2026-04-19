'use client';

import { useState } from 'react';

import { Button } from './ui/button';

import {
  ConfigurationDto,
  ConfigScopeType,
  CreateConfigurationDto,
  RollbackConfigurationDto,
  ConfigurationHistoryItemDto,
} from '@/lib/settings-types';
import { getOperatorSession } from '@/lib/operator-session';
import { DestructiveOperatorAction } from './destructive-operator-action';

interface SettingsWorkspaceProps {
  environment?: string;
  tenantId?: string;
}

export function SettingsWorkspace({
  environment,
  tenantId,
}: SettingsWorkspaceProps) {
  const [configurations, setConfigurations] = useState<ConfigurationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedConfig, setSelectedConfig] = useState<ConfigurationDto | null>(
    null,
  );
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ConfigurationHistoryItemDto[]>([]);

  const loadConfigurations = async () => {
    setLoading(true);
    setError(null);

    try {
      const session = await getOperatorSession();
      if (!session) {
        throw new Error('Unauthorized');
      }

      // Build query params
      const params = new URLSearchParams();
      if (environment) params.append('environment', environment);
      if (tenantId) params.append('tenantId', tenantId);

      const response = await fetch(
        `/api/operator/settings/configurations?${params.toString()}`,
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to load configurations');
      }

      const data = await response.json();
      setConfigurations(data);
    } catch (err) {
      console.error('Failed to load configurations:', err);
      setError(
        err instanceof Error ? err.message : 'Failed to load configurations',
      );
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async (configKey: string) => {
    try {
      const session = await getOperatorSession();
      if (!session) {
        throw new Error('Unauthorized');
      }

      // Build query params for history
      const params = new URLSearchParams();
      params.append('scopeType', ConfigScopeType.GLOBAL);

      const response = await fetch(
        `/api/operator/settings/configurations/${configKey}/history?${params.toString()}`,
      );

      if (!response.ok) {
        throw new Error('Failed to load configuration history');
      }

      const data = await response.json();
      setHistory(data);
      setShowHistory(true);
    } catch (err) {
      console.error('Failed to load history:', err);
      setError('Failed to load configuration history');
    }
  };

  const handleCreateConfiguration = async (
    dto: CreateConfigurationDto,
  ): Promise<void> => {
    try {
      const session = await getOperatorSession();
      if (!session) {
        throw new Error('Unauthorized');
      }

      const response = await fetch('/api/operator/settings/configurations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dto),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create configuration');
      }

      await loadConfigurations();
    } catch (err) {
      console.error('Failed to create configuration:', err);
      throw err;
    }
  };

  const handleUpdateConfiguration = async (
    configKey: string,
    dto: Partial<CreateConfigurationDto>,
  ): Promise<void> => {
    try {
      const session = await getOperatorSession();
      if (!session) {
        throw new Error('Unauthorized');
      }

      const response = await fetch(
        `/api/operator/settings/configurations/${configKey}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(dto),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update configuration');
      }

      await loadConfigurations();
    } catch (err) {
      console.error('Failed to update configuration:', err);
      throw err;
    }
  };

  const handleRollbackConfiguration = async (
    configKey: string,
    dto: RollbackConfigurationDto,
  ): Promise<void> => {
    try {
      const session = await getOperatorSession();
      if (!session) {
        throw new Error('Unauthorized');
      }

      const response = await fetch(
        `/api/operator/settings/configurations/${configKey}/rollback`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(dto),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to rollback configuration');
      }

      await loadConfigurations();
    } catch (err) {
      console.error('Failed to rollback configuration:', err);
      throw err;
    }
  };

  const getRiskLevel = (configKey: string): 'high' | 'medium' | 'low' => {
    const sensitiveKeys = /^(risk\..*|execution\..*|capital\..*)/;
    return sensitiveKeys.test(configKey) ? 'high' : 'medium';
  };

  // Load configurations on mount
  useState(() => {
    loadConfigurations();
  });

  return (
    <div className="space-y-6">
      {/* Policy Configurations Section */}
      <div>
        <h2 className="text-xl font-semibold mb-4">
          Policy Configurations
        </h2>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800">{error}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setError(null)}
              className="mt-2"
            >
              Dismiss
            </Button>
          </div>
        )}

        {loading ? (
          <div className="text-center py-8 text-slate-500">Loading...</div>
        ) : (
          <>
            {/* Create Configuration Button */}
            <div className="mb-4">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  // Simple inline creation dialog (simplified for this implementation)
                  const configKey = prompt('Enter configuration key:');
                  const configValue = prompt('Enter configuration value:');
                  const isSensitive = confirm('Is this a sensitive configuration?');

                  if (configKey && configValue) {
                    const dto: CreateConfigurationDto = {
                      configKey,
                      configValue,
                      isSensitive,
                      scopeType: ConfigScopeType.GLOBAL,
                      approveReason: isSensitive ? prompt('Enter approval reason:') : undefined,
                    };

                    handleCreateConfiguration(dto).catch((err) => {
                      alert(
                        `Failed to create configuration: ${err instanceof Error ? err.message : err}`,
                      );
                    });
                  }
                }}
              >
                Create Configuration
              </Button>
            </div>

            {/* Configurations Table */}
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
                        colSpan={8}
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
                            {config.scopeType === ConfigScopeType.ENVIRONMENT && (
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
                              loadHistory(config.configKey);
                            }}
                          >
                            History
                          </Button>
                          <DestructiveOperatorAction
                            actionLabel="Edit"
                            level={getRiskLevel(config.configKey)}
                            onConfirmed={async () => {
                              const newValue = prompt(
                                `Enter new value for ${config.configKey}:`,
                                config.configValue,
                              );
                              if (newValue !== null && newValue !== config.configValue) {
                                const isSensitive = confirm(
                                  'Is this a sensitive configuration?',
                                );
                                await handleUpdateConfiguration(config.configKey, {
                                  configValue: newValue,
                                  isSensitive,
                                  approveReason: isSensitive ? prompt('Enter approval reason:') : undefined,
                                });
                              }
                            }}
                            disabled={false}
                          />
                          <DestructiveOperatorAction
                            actionLabel="Rollback"
                            level={getRiskLevel(config.configKey)}
                            impactPreview={{
                              affectedResources: `Configuration key: ${config.configKey}`,
                              potentialConsequences: 'This will revert configuration to specified version, affecting all systems using this configuration.',
                              mitigation: 'Rollback can be undone by creating a new version.',
                            }}
                            onConfirmed={async () => {
                              const toVersion = parseInt(
                                prompt(`Rollback ${config.configKey} to version:`) || '0',
                                10,
                              );
                              if (toVersion > 0) {
                                const isSensitive = confirm(
                                  'Is this a sensitive configuration?',
                                );
                                await handleRollbackConfiguration(config.configKey, {
                                  toVersion,
                                  isSensitive,
                                  approveReason: isSensitive ? prompt('Enter approval reason:') : undefined,
                                });
                              }
                            }}
                            disabled={false}
                          />
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

      {/* Configuration History Modal */}
      {showHistory && selectedConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="max-w-4xl w-full rounded-lg border border-slate-800 bg-slate-950 p-6 shadow-xl max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">
              Configuration History: {selectedConfig.configKey}
            </h3>
            <div className="mb-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowHistory(false)}
              >
                Close
              </Button>
            </div>
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
                        colSpan={7}
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
          </div>
        </div>
      )}
    </div>
  );
}
