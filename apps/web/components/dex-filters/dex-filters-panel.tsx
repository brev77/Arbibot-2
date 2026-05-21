'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { useDexFiltersConfig, useUpdateDexFiltersConfig, usePreviewDexFilters, useDexFiltersMetrics } from '@/lib/use-dex-filters';
import { DEFAULT_DEX_FILTERS_CONFIG, type FiltersPreview, type FilterBreakdown, type RiskLevel } from '@arbibot/contracts';
import { Loader2, Play, TrendingUp, AlertTriangle } from 'lucide-react';

interface DexFiltersPanelProps {
  environment?: string;
  tenantId?: string;
}

export function DexFiltersPanel({ environment, tenantId }: DexFiltersPanelProps) {
  const { data: config, isLoading: isLoadingConfig, error: configError } = useDexFiltersConfig(environment, tenantId);
  const { data: metrics, isLoading: isLoadingMetrics } = useDexFiltersMetrics();
  const updateConfig = useUpdateDexFiltersConfig();
  const previewFilters = usePreviewDexFilters();
  
  const [localConfig, setLocalConfig] = useState(DEFAULT_DEX_FILTERS_CONFIG);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewResult, setPreviewResult] = useState<FiltersPreview | null>(null);

  // Update local config when remote config loads
  if (config && JSON.stringify(config) !== JSON.stringify(localConfig)) {
    setLocalConfig(config);
  }

  const handleSave = async () => {
    try {
      await updateConfig.mutateAsync({
        config: localConfig,
        environment,
        tenantId,
      });
      // Invalidate preview on save
      setPreviewResult(null);
    } catch (error) {
      console.error('Failed to save DEX filters configuration:', error);
    }
  };

  const handlePreview = async () => {
    setIsPreviewing(true);
    try {
      const result = await previewFilters.mutateAsync(localConfig);
      setPreviewResult(result);
    } catch (error) {
      console.error('Failed to preview filters:', error);
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleToggleGlobal = (enabled: boolean) => {
    setLocalConfig(prev => ({ ...prev, enabled }));
  };

  const handleUpdateFilter = (filterKey: keyof typeof localConfig.filters, updates: Record<string, unknown>) => {
    setLocalConfig(prev => ({
      ...prev,
      filters: {
        ...prev.filters,
        [filterKey]: {
          ...prev.filters[filterKey],
          ...updates,
        },
      },
    }));
  };

  if (isLoadingConfig) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Loading DEX filters configuration...</span>
      </div>
    );
  }

  if (configError) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Error
          </CardTitle>
          <CardDescription>
            Failed to load DEX filters configuration. Please try again later.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">DEX Filters Configuration</h2>
          <p className="text-muted-foreground">
            Configure DEX opportunity filters to control which arbitrage opportunities are processed
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => void handlePreview()}
            disabled={isPreviewing || updateConfig.isPending}
          >
            {isPreviewing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Preview Impact
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={updateConfig.isPending}
          >
            {updateConfig.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Save Changes
          </Button>
        </div>
      </div>

      {/* Global Toggle */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Enable DEX Filters</CardTitle>
              <CardDescription>
                When enabled, all DEX opportunities will be filtered according to the rules below
              </CardDescription>
            </div>
            <Switch
              checked={localConfig.enabled}
              onCheckedChange={handleToggleGlobal}
            />
          </div>
        </CardHeader>
      </Card>

      {/* Filter Configuration */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Threshold Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Threshold Filters</CardTitle>
            <CardDescription>Set minimum/maximum values for key metrics</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FilterToggle
              label="Min Spread %"
              description="Minimum spread percentage to consider an opportunity"
              enabled={localConfig.filters.minSpreadPct.enabled}
              value={localConfig.filters.minSpreadPct.value}
              onToggle={(enabled: boolean) => handleUpdateFilter('minSpreadPct', { enabled })}
              onValueChange={(value: number) => handleUpdateFilter('minSpreadPct', { value })}
              suffix="%"
            />
            <FilterToggle
              label="Min Profit USD"
              description="Minimum profit in USD to consider an opportunity"
              enabled={localConfig.filters.minProfitUsd.enabled}
              value={localConfig.filters.minProfitUsd.value}
              onToggle={(enabled: boolean) => handleUpdateFilter('minProfitUsd', { enabled })}
              onValueChange={(value: number) => handleUpdateFilter('minProfitUsd', { value })}
              prefix="$"
            />
            <FilterToggle
              label="Max Fees USD"
              description="Maximum fees in USD to consider an opportunity"
              enabled={localConfig.filters.maxFeesUsd.enabled}
              value={localConfig.filters.maxFeesUsd.value}
              onToggle={(enabled: boolean) => handleUpdateFilter('maxFeesUsd', { enabled })}
              onValueChange={(value: number) => handleUpdateFilter('maxFeesUsd', { value })}
              prefix="$"
            />
          </CardContent>
        </Card>

        {/* Volume Range Filter */}
        <Card>
          <CardHeader>
            <CardTitle>Volume Range Filter</CardTitle>
            <CardDescription>Filter opportunities by trading volume range</CardDescription>
          </CardHeader>
          <CardContent>
            <RangeFilter
              label="Volume Range (USD)"
              description="Acceptable volume range for opportunities"
              enabled={localConfig.filters.volumeRange.enabled}
              min={localConfig.filters.volumeRange.min}
              max={localConfig.filters.volumeRange.max}
              onToggle={(enabled: boolean) => handleUpdateFilter('volumeRange', { enabled })}
              onMinChange={(min: number) => handleUpdateFilter('volumeRange', { min })}
              onMaxChange={(max: number) => handleUpdateFilter('volumeRange', { max })}
              prefix="$"
            />
          </CardContent>
        </Card>

        {/* Token Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Token Filters</CardTitle>
            <CardDescription>Filter by specific tokens, chains, or quote assets</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <TagFilter
              label="Blacklist Tokens"
              description="Tokens to exclude from opportunities"
              enabled={localConfig.filters.blacklistTokens.enabled}
              tokens={localConfig.filters.blacklistTokens.tokens}
              onToggle={(enabled: boolean) => handleUpdateFilter('blacklistTokens', { enabled })}
              onTokensChange={(tokens: string[]) => handleUpdateFilter('blacklistTokens', { tokens })}
            />
            <TagFilter
              label="Allowed Chains"
              description="Only allow opportunities on these chains"
              enabled={localConfig.filters.allowedChains.enabled}
              tokens={localConfig.filters.allowedChains.chains}
              onToggle={(enabled: boolean) => handleUpdateFilter('allowedChains', { enabled })}
              onTokensChange={(chains: string[]) => handleUpdateFilter('allowedChains', { chains })}
            />
            <TagFilter
              label="Quote Assets"
              description="Only allow opportunities with these quote assets"
              enabled={localConfig.filters.quoteAssets.enabled}
              tokens={localConfig.filters.quoteAssets.assets}
              onToggle={(enabled: boolean) => handleUpdateFilter('quoteAssets', { enabled })}
              onTokensChange={(assets: string[]) => handleUpdateFilter('quoteAssets', { assets })}
            />
          </CardContent>
        </Card>

        {/* Risk Filter */}
        <Card>
          <CardHeader>
            <CardTitle>Risk Filter</CardTitle>
            <CardDescription>Filter opportunities by risk level</CardDescription>
          </CardHeader>
          <CardContent>
            <RiskFilter
              label="High Risk"
              description="Maximum risk level to allow"
              enabled={localConfig.filters.highRisk.enabled}
              maxRiskLevel={localConfig.filters.highRisk.maxRiskLevel}
              onToggle={(enabled: boolean) => handleUpdateFilter('highRisk', { enabled })}
              onRiskLevelChange={(maxRiskLevel: 'low' | 'medium' | 'high') => handleUpdateFilter('highRisk', { maxRiskLevel })}
            />
          </CardContent>
        </Card>
      </div>

      {/* Preview Results */}
      {previewResult && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Filter Preview Results
            </CardTitle>
            <CardDescription>
              Based on the last 1,000 opportunities
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <div className="text-sm font-medium text-muted-foreground">Total Opportunities</div>
                <div className="text-2xl font-bold">{previewResult.totalOpportunities}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Filtered Out</div>
                <div className="text-2xl font-bold text-destructive">{previewResult.filteredOut}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Pass Rate</div>
                <div className="text-2xl font-bold text-green-600">
                  {(100 - previewResult.filteredPercentage).toFixed(1)}%
                </div>
              </div>
            </div>
            <div className="mt-4">
              <div className="text-sm font-medium text-muted-foreground mb-2">Breakdown</div>
              <div className="grid gap-2 md:grid-cols-4">
                {Object.entries(previewResult.breakdown).map(([key, value]: [string, FilterBreakdown]) => (
                  <div key={key} className="flex items-center justify-between p-2 rounded bg-muted">
                    <span className="text-sm capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                    <Badge variant="secondary">{value.count}</Badge>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Metrics */}
      {metrics && !isLoadingMetrics && (
        <Card>
          <CardHeader>
            <CardTitle>Filter Metrics (Last 24 Hours)</CardTitle>
            <CardDescription>
              Real-time metrics for DEX filter performance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <div className="text-sm font-medium text-muted-foreground">Total Opportunities</div>
                <div className="text-2xl font-bold">{metrics.last24h.totalOpportunities}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Passed Filters</div>
                <div className="text-2xl font-bold text-green-600">{metrics.last24h.passedFilters}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Rejected by Filters</div>
                <div className="text-2xl font-bold text-destructive">{metrics.last24h.rejectedByFilters}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Sub-components (simplified for brevity)
interface FilterToggleProps {
  label: string;
  description: string;
  enabled: boolean;
  value: number;
  onToggle: (enabled: boolean) => void;
  onValueChange: (value: number) => void;
  suffix?: string;
  prefix?: string;
}

function FilterToggle({ label, description, enabled, value, onToggle, onValueChange, suffix = '' }: FilterToggleProps) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={onToggle} />
          <div>
            <div className="font-medium">{label}</div>
            <div className="text-xs text-muted-foreground">{description}</div>
          </div>
        </div>
        {enabled && (
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              value={value}
              onChange={(e) => onValueChange(Number(e.target.value))}
              className="w-20 px-2 py-1 text-sm border rounded"
              disabled={!enabled}
            />
            {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

interface RangeFilterProps {
  label: string;
  description: string;
  enabled: boolean;
  min: number;
  max: number;
  onToggle: (enabled: boolean) => void;
  onMinChange: (min: number) => void;
  onMaxChange: (max: number) => void;
  prefix?: string;
}

function RangeFilter({ label, description, enabled, min, max, onToggle, onMinChange, onMaxChange }: RangeFilterProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={onToggle} />
        <div>
          <div className="font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
      </div>
      {enabled && (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">Min</label>
            <input
              type="number"
              value={min}
              onChange={(e) => onMinChange(Number(e.target.value))}
              className="w-full px-2 py-1 text-sm border rounded"
            />
          </div>
          <span className="text-muted-foreground">to</span>
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">Max</label>
            <input
              type="number"
              value={max}
              onChange={(e) => onMaxChange(Number(e.target.value))}
              className="w-full px-2 py-1 text-sm border rounded"
            />
          </div>
        </div>
      )}
    </div>
  );
}

interface TagFilterProps {
  label: string;
  description: string;
  enabled: boolean;
  tokens: string[];
  onToggle: (enabled: boolean) => void;
  onTokensChange: (tokens: string[]) => void;
}

function TagFilter({ label, description, enabled, tokens, onToggle, onTokensChange }: TagFilterProps) {
  const [inputValue, setInputValue] = useState('');
  const [tagList, setTagList] = useState<string[]>(tokens || []);

  const handleAddTag = () => {
    if (inputValue.trim() && !tagList.includes(inputValue.trim())) {
      const newTags = [...tagList, inputValue.trim()];
      setTagList(newTags);
      onTokensChange(newTags);
      setInputValue('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const newTags = tagList.filter(tag => tag !== tagToRemove);
    setTagList(newTags);
    onTokensChange(newTags);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={onToggle} />
        <div>
          <div className="font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
      </div>
      {enabled && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Add item..."
              className="flex-1 px-2 py-1 text-sm border rounded"
            />
            <Button size="sm" onClick={handleAddTag}>Add</Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {tagList.map((tag) => (
              <Badge key={tag} variant="default" className="cursor-pointer" onClick={() => handleRemoveTag(tag)}>
                {tag} ×
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface RiskFilterProps {
  label: string;
  description: string;
  enabled: boolean;
  maxRiskLevel: RiskLevel;
  onToggle: (enabled: boolean) => void;
  onRiskLevelChange: (level: RiskLevel) => void;
}

function RiskFilter({ label, description, enabled, maxRiskLevel, onToggle, onRiskLevelChange }: RiskFilterProps) {
  const riskLevels = ['low', 'medium', 'high'] as const;
  
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Switch checked={enabled} onCheckedChange={onToggle} />
        <div>
          <div className="font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
      </div>
      {enabled && (
        <div className="flex flex-wrap gap-2">
              {riskLevels.map((level) => (
                <Badge
                  key={level}
                  variant={maxRiskLevel === level ? 'default' : 'secondary'}
                  className="cursor-pointer"
                  onClick={() => onRiskLevelChange(level)}
                >
                  {level}
                </Badge>
              ))}
        </div>
      )}
    </div>
  );
}