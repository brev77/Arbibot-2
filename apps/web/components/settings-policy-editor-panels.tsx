'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { DestructiveOperatorAction } from '@/components/destructive-operator-action';
import { Button } from '@/components/ui/button';
import {
  intakeRoutingTiersSchema,
  intakeThrottlingSchema,
  paperDiscoverySchema,
  validateConfigJson,
} from '@/lib/policy-config-registry';

function splitKeys(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type TierBucketForm = {
  enabled: boolean;
  keysText: string;
};

function emptyTier(): TierBucketForm {
  return { enabled: false, keysText: '' };
}

export type PolicyUpsertFn = (args: {
  configKey: string;
  jsonString: string;
  asDraft: boolean;
}) => Promise<void>;

function FieldLabel({
  children,
  htmlFor,
}: {
  children: ReactNode;
  htmlFor?: string;
}): ReactNode {
  return (
    <label
      htmlFor={htmlFor}
      className="block text-sm text-slate-300 html.theme-light:text-slate-700"
    >
      {children}
    </label>
  );
}

export function IntakeThrottlingPanel({
  effectiveJson,
  onUpsert,
}: {
  effectiveJson: string | null;
  onUpsert: PolicyUpsertFn;
}): ReactNode {
  const [requireAudit, setRequireAudit] = useState(false);
  const [warmMs, setWarmMs] = useState('');
  const [coldMs, setColdMs] = useState('');
  const [minRoute, setMinRoute] = useState('');
  const [advancedJson, setAdvancedJson] = useState('');
  const [useAdvanced, setUseAdvanced] = useState(false);
  const [asDraft, setAsDraft] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    if (effectiveJson === null) return;
    setAdvancedJson(effectiveJson);
    try {
      const o: unknown = JSON.parse(effectiveJson);
      const p = intakeThrottlingSchema.safeParse(o);
      if (p.success) {
        setRequireAudit(p.data.requireAuditOnThrottle ?? false);
        setWarmMs(
          p.data.warmSampleIntervalMs !== undefined
            ? String(p.data.warmSampleIntervalMs)
            : '',
        );
        setColdMs(
          p.data.coldSampleIntervalMs !== undefined
            ? String(p.data.coldSampleIntervalMs)
            : '',
        );
        setMinRoute(
          p.data.minRouteScore !== undefined ? String(p.data.minRouteScore) : '',
        );
      }
    } catch {
      /* keep fields */
    }
  }, [effectiveJson]);

  const buildJsonFromFields = (): string => {
    const warmSampleIntervalMs = warmMs.trim()
      ? Number(warmMs)
      : undefined;
    const coldSampleIntervalMs = coldMs.trim()
      ? Number(coldMs)
      : undefined;
    const minRouteScore = minRoute.trim() ? Number(minRoute) : undefined;
    const obj = {
      ...(requireAudit ? { requireAuditOnThrottle: true } : {}),
      ...(warmSampleIntervalMs !== undefined && !Number.isNaN(warmSampleIntervalMs)
        ? { warmSampleIntervalMs }
        : {}),
      ...(coldSampleIntervalMs !== undefined && !Number.isNaN(coldSampleIntervalMs)
        ? { coldSampleIntervalMs }
        : {}),
      ...(minRouteScore !== undefined && !Number.isNaN(minRouteScore)
        ? { minRouteScore }
        : {}),
    };
    return JSON.stringify(obj);
  };

  const submit = async (): Promise<void> => {
    setLocalErr(null);
    const raw = useAdvanced ? advancedJson : buildJsonFromFields();
    const v = validateConfigJson('intake.throttling', raw);
    if (!v.ok) {
      setLocalErr(v.error);
      throw new Error(v.error);
    }
    await onUpsert({
      configKey: 'intake.throttling',
      jsonString: v.normalized,
      asDraft,
    });
  };

  return (
    <section className="rounded-lg border border-slate-800 p-4 html.theme-light:border-slate-200">
      <h3 className="mt-0 text-base font-medium">intake.throttling</h3>
      <p className="text-sm text-slate-500 mb-4">
        Controls sampling intervals and optional route-score gate. See{' '}
        <code className="text-xs">docs/intake-policy-config-keys.md</code>.
      </p>
      {localErr && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {localErr}
        </div>
      )}
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={useAdvanced}
          onChange={(e) => setUseAdvanced(e.target.checked)}
        />
        Advanced: edit raw JSON
      </label>
      {useAdvanced ? (
        <textarea
          className="mb-3 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-xs html.theme-light:border-slate-300 html.theme-light:bg-white"
          rows={8}
          value={advancedJson}
          onChange={(e) => setAdvancedJson(e.target.value)}
        />
      ) : (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel>Warm sample interval (ms)</FieldLabel>
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
              value={warmMs}
              onChange={(e) => setWarmMs(e.target.value)}
              placeholder="5000"
            />
          </div>
          <div>
            <FieldLabel>Cold sample interval (ms)</FieldLabel>
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
              value={coldMs}
              onChange={(e) => setColdMs(e.target.value)}
              placeholder="30000"
            />
          </div>
          <div>
            <FieldLabel>Min route score (0–1)</FieldLabel>
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
              value={minRoute}
              onChange={(e) => setMinRoute(e.target.value)}
              placeholder="0.2"
            />
          </div>
          <label className="flex items-end gap-2 pb-1 text-sm">
            <input
              type="checkbox"
              checked={requireAudit}
              onChange={(e) => setRequireAudit(e.target.checked)}
            />
            Require audit on throttle
          </label>
        </div>
      )}
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={asDraft}
          onChange={(e) => setAsDraft(e.target.checked)}
        />
        Save as draft
      </label>
      <DestructiveOperatorAction
        actionLabel="Save intake.throttling"
        level="medium"
        impactPreview={{
          affectedResources: 'intake.throttling',
          potentialConsequences:
            'Updates throttling for market-intake after cache refresh / effective fetch.',
        }}
        onConfirm={submit}
        disabled={false}
      />
    </section>
  );
}

function tierFromForm(f: TierBucketForm): { enabled: boolean; instrumentKeys: string[] } | undefined {
  if (!f.enabled && !f.keysText.trim()) return undefined;
  return {
    enabled: f.enabled,
    instrumentKeys: splitKeys(f.keysText),
  };
}

export function IntakeRoutingTiersPanel({
  effectiveJson,
  onUpsert,
}: {
  effectiveJson: string | null;
  onUpsert: PolicyUpsertFn;
}): ReactNode {
  const [hot, setHot] = useState<TierBucketForm>(emptyTier());
  const [warm, setWarm] = useState<TierBucketForm>(emptyTier());
  const [cold, setCold] = useState<TierBucketForm>(emptyTier());
  const [advancedJson, setAdvancedJson] = useState('');
  const [useAdvanced, setUseAdvanced] = useState(false);
  const [asDraft, setAsDraft] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    if (effectiveJson === null) return;
    setAdvancedJson(effectiveJson);
    try {
      const o: unknown = JSON.parse(effectiveJson);
      const p = intakeRoutingTiersSchema.safeParse(o);
      if (p.success) {
        const apply = (
          t: typeof p.data.hot,
          set: (v: TierBucketForm) => void,
        ): void => {
          if (!t) {
            set(emptyTier());
            return;
          }
          set({
            enabled: t.enabled ?? false,
            keysText: (t.instrumentKeys ?? []).join(', '),
          });
        };
        apply(p.data.hot, setHot);
        apply(p.data.warm, setWarm);
        apply(p.data.cold, setCold);
      }
    } catch {
      /* noop */
    }
  }, [effectiveJson]);

  const buildJson = (): string => {
    const hotB = tierFromForm(hot);
    const warmB = tierFromForm(warm);
    const coldB = tierFromForm(cold);
    const obj = {
      ...(hotB ? { hot: hotB } : {}),
      ...(warmB ? { warm: warmB } : {}),
      ...(coldB ? { cold: coldB } : {}),
    };
    return JSON.stringify(obj);
  };

  const submit = async (): Promise<void> => {
    setLocalErr(null);
    const raw = useAdvanced ? advancedJson : buildJson();
    const v = validateConfigJson('intake.routing.tiers', raw);
    if (!v.ok) {
      setLocalErr(v.error);
      throw new Error(v.error);
    }
    await onUpsert({
      configKey: 'intake.routing.tiers',
      jsonString: v.normalized,
      asDraft,
    });
  };

  const tierFields = (
    label: string,
    f: TierBucketForm,
    set: (v: TierBucketForm) => void,
  ): ReactNode => (
    <div className="rounded border border-slate-800 p-3 html.theme-light:border-slate-200">
      <p className="mt-0 text-sm font-medium">{label}</p>
      <label className="mb-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={f.enabled}
          onChange={(e) => set({ ...f, enabled: e.target.checked })}
        />
        Enabled
      </label>
      <FieldLabel>Instrument keys (comma or newline separated; use * for any)</FieldLabel>
      <textarea
        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-xs html.theme-light:border-slate-300 html.theme-light:bg-white"
        rows={3}
        value={f.keysText}
        onChange={(e) => set({ ...f, keysText: e.target.value })}
      />
    </div>
  );

  return (
    <section className="rounded-lg border border-slate-800 p-4 html.theme-light:border-slate-200">
      <h3 className="mt-0 text-base font-medium">intake.routing.tiers</h3>
      <p className="text-sm text-slate-500 mb-4">
        Optional routing buckets for intake. See{' '}
        <code className="text-xs">docs/intake-policy-config-keys.md</code>.
      </p>
      {localErr && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {localErr}
        </div>
      )}
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={useAdvanced}
          onChange={(e) => setUseAdvanced(e.target.checked)}
        />
        Advanced: edit raw JSON
      </label>
      {useAdvanced ? (
        <textarea
          className="mb-3 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-xs html.theme-light:border-slate-300 html.theme-light:bg-white"
          rows={10}
          value={advancedJson}
          onChange={(e) => setAdvancedJson(e.target.value)}
        />
      ) : (
        <div className="mb-3 grid gap-3 lg:grid-cols-3">
          {tierFields('Hot', hot, setHot)}
          {tierFields('Warm', warm, setWarm)}
          {tierFields('Cold', cold, setCold)}
        </div>
      )}
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={asDraft}
          onChange={(e) => setAsDraft(e.target.checked)}
        />
        Save as draft
      </label>
      <DestructiveOperatorAction
        actionLabel="Save intake.routing.tiers"
        level="medium"
        impactPreview={{
          affectedResources: 'intake.routing.tiers',
          potentialConsequences: 'Updates routing hints used by market-intake policy bundle.',
        }}
        onConfirm={submit}
        disabled={false}
      />
    </section>
  );
}

export function PaperDiscoveryPanel({
  effectiveJson,
  onUpsert,
}: {
  effectiveJson: string | null;
  onUpsert: PolicyUpsertFn;
}): ReactNode {
  const [enabled, setEnabled] = useState(false);
  const [intervalMs, setIntervalMs] = useState('');
  const [minProfitUsd, setMinProfitUsd] = useState('');
  const [minLiq, setMinLiq] = useState('');
  const [maxCand, setMaxCand] = useState('');
  const [tokensText, setTokensText] = useState('');
  const [routesText, setRoutesText] = useState('');
  const [advancedJson, setAdvancedJson] = useState('');
  const [useAdvanced, setUseAdvanced] = useState(false);
  const [asDraft, setAsDraft] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  useEffect(() => {
    if (effectiveJson === null) return;
    setAdvancedJson(effectiveJson);
    try {
      const o: unknown = JSON.parse(effectiveJson);
      const p = paperDiscoverySchema.safeParse(o);
      if (p.success) {
        setEnabled(p.data.enabled ?? false);
        setIntervalMs(
          p.data.intervalMs !== undefined ? String(p.data.intervalMs) : '',
        );
        setMinProfitUsd(
          p.data.minProfitUsd !== undefined ? String(p.data.minProfitUsd) : '',
        );
        setMinLiq(
          p.data.minLiquidityScore !== undefined
            ? String(p.data.minLiquidityScore)
            : '',
        );
        setMaxCand(
          p.data.maxCandidatesPerRun !== undefined
            ? String(p.data.maxCandidatesPerRun)
            : '',
        );
        setTokensText((p.data.paperOnlyTokens ?? []).join(', '));
        setRoutesText((p.data.paperOnlyRoutes ?? []).join(', '));
      }
    } catch {
      /* noop */
    }
  }, [effectiveJson]);

  const buildJson = (): string => {
    const interval = intervalMs.trim() ? Number(intervalMs) : undefined;
    const minP = minProfitUsd.trim() ? Number(minProfitUsd) : undefined;
    const minL = minLiq.trim() ? Number(minLiq) : undefined;
    const maxC = maxCand.trim() ? Number(maxCand) : undefined;
    const obj = {
      ...(enabled ? { enabled: true } : {}),
      ...(interval !== undefined && !Number.isNaN(interval) ? { intervalMs: interval } : {}),
      ...(minP !== undefined && !Number.isNaN(minP) ? { minProfitUsd: minP } : {}),
      ...(minL !== undefined && !Number.isNaN(minL) ? { minLiquidityScore: minL } : {}),
      ...(maxC !== undefined && !Number.isNaN(maxC)
        ? { maxCandidatesPerRun: Math.trunc(maxC) }
        : {}),
      ...(tokensText.trim()
        ? { paperOnlyTokens: splitKeys(tokensText) }
        : {}),
      ...(routesText.trim()
        ? { paperOnlyRoutes: splitKeys(routesText) }
        : {}),
    };
    return JSON.stringify(obj);
  };

  const submit = async (): Promise<void> => {
    setLocalErr(null);
    const raw = useAdvanced ? advancedJson : buildJson();
    const v = validateConfigJson('paper.discovery', raw);
    if (!v.ok) {
      setLocalErr(v.error);
      throw new Error(v.error);
    }
    await onUpsert({
      configKey: 'paper.discovery',
      jsonString: v.normalized,
      asDraft,
    });
  };

  return (
    <section className="rounded-lg border border-slate-800 p-4 html.theme-light:border-slate-200">
      <h3 className="mt-0 text-base font-medium">paper.discovery</h3>
      <p className="text-sm text-slate-500 mb-4">
        Paper discovery worker policy. See{' '}
        <code className="text-xs">docs/paper-discovery-config-keys.md</code>.
      </p>
      {localErr && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {localErr}
        </div>
      )}
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={useAdvanced}
          onChange={(e) => setUseAdvanced(e.target.checked)}
        />
        Advanced: edit raw JSON
      </label>
      {useAdvanced ? (
        <textarea
          className="mb-3 w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 font-mono text-xs html.theme-light:border-slate-300 html.theme-light:bg-white"
          rows={12}
          value={advancedJson}
          onChange={(e) => setAdvancedJson(e.target.value)}
        />
      ) : (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Worker enabled
          </label>
          <div>
            <FieldLabel>Interval (ms, min 5000)</FieldLabel>
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
              value={intervalMs}
              onChange={(e) => setIntervalMs(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Min profit (USD)</FieldLabel>
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
              value={minProfitUsd}
              onChange={(e) => setMinProfitUsd(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Min liquidity score (0–1)</FieldLabel>
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
              value={minLiq}
              onChange={(e) => setMinLiq(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Max candidates per run</FieldLabel>
            <input
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm html.theme-light:border-slate-300 html.theme-light:bg-white"
              value={maxCand}
              onChange={(e) => setMaxCand(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <FieldLabel>Paper-only tokens</FieldLabel>
            <textarea
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-xs html.theme-light:border-slate-300 html.theme-light:bg-white"
              rows={2}
              value={tokensText}
              onChange={(e) => setTokensText(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <FieldLabel>Paper-only routes</FieldLabel>
            <textarea
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-xs html.theme-light:border-slate-300 html.theme-light:bg-white"
              rows={2}
              value={routesText}
              onChange={(e) => setRoutesText(e.target.value)}
            />
          </div>
        </div>
      )}
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={asDraft}
          onChange={(e) => setAsDraft(e.target.checked)}
        />
        Save as draft
      </label>
      <div className="flex flex-wrap gap-2">
        <DestructiveOperatorAction
          actionLabel="Save paper.discovery"
          level="medium"
          impactPreview={{
            affectedResources: 'paper.discovery',
            potentialConsequences:
              'Updates paper discovery worker after config cache TTL in paper-trading-service.',
          }}
          onConfirm={submit}
          disabled={false}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            setAdvancedJson(
              JSON.stringify(
                {
                  enabled: true,
                  intervalMs: 15_000,
                  minProfitUsd: 1,
                  minLiquidityScore: 0.2,
                  maxCandidatesPerRun: 20,
                },
                null,
                2,
              ),
            );
            setUseAdvanced(true);
          }}
        >
          Load dev preset (JSON)
        </Button>
      </div>
    </section>
  );
}
