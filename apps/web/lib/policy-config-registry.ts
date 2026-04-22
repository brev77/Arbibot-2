import { z } from 'zod';

const tierBucketSchema = z
  .object({
    enabled: z.boolean().optional(),
    instrumentKeys: z.array(z.string()).optional(),
  })
  .strict()
  .optional();

/** `intake.throttling` — see docs/intake-policy-config-keys.md */
export const intakeThrottlingSchema = z
  .object({
    requireAuditOnThrottle: z.boolean().optional(),
    warmSampleIntervalMs: z.number().nonnegative().optional(),
    coldSampleIntervalMs: z.number().nonnegative().optional(),
    minRouteScore: z.number().min(0).max(1).optional(),
  })
  .strict();

/** `intake.routing.tiers` */
export const intakeRoutingTiersSchema = z
  .object({
    hot: tierBucketSchema,
    warm: tierBucketSchema,
    cold: tierBucketSchema,
  })
  .strict();

/** `paper.discovery` — see docs/paper-discovery-config-keys.md */
export const paperDiscoverySchema = z
  .object({
    enabled: z.boolean().optional(),
    intervalMs: z.number().min(5000).optional(),
    minProfitUsd: z.number().optional(),
    minLiquidityScore: z.number().min(0).max(1).optional(),
    maxCandidatesPerRun: z.number().int().nonnegative().optional(),
    paperOnlyTokens: z.array(z.string()).optional(),
    paperOnlyRoutes: z.array(z.string()).optional(),
  })
  .strict();

/** `opportunity.filters` — planned; consumers TBD */
export const opportunityFiltersSchema = z
  .object({
    minSpreadBps: z.number().nonnegative().optional(),
    maxConcurrentOpportunities: z.number().int().nonnegative().optional(),
    blockedVenueIds: z.array(z.string()).optional(),
    blockedRouteKeys: z.array(z.string()).optional(),
  })
  .passthrough();

/** `risk.evaluation` — sensitive prefix */
export const riskEvaluationSchema = z
  .object({
    strictMode: z.boolean().optional(),
    decisionCacheTtlMs: z.number().nonnegative().optional(),
  })
  .passthrough();

/** `execution.plan` — sensitive prefix */
export const executionPlanPolicySchema = z
  .object({
    defaultMaxSlippageBps: z.number().nonnegative().optional(),
    legTimeoutMs: z.number().nonnegative().optional(),
    maxRetriesPerLeg: z.number().int().nonnegative().optional(),
  })
  .passthrough();

/** `capital.reservation` — sensitive prefix */
export const capitalReservationPolicySchema = z
  .object({
    reservationTtlMs: z.number().nonnegative().optional(),
    maxInFlightReservations: z.number().int().nonnegative().optional(),
  })
  .passthrough();

/** `features.flags` — loose feature map */
export const featuresFlagsSchema = z.record(z.string(), z.unknown());

export type PolicyConfigRegistryEntry = {
  readonly configKey: string;
  readonly title: string;
  /** Repo-relative path for operators */
  readonly docPath: string;
  readonly consumers: readonly string[];
  /** When set, JSON is validated before save in settings UI */
  readonly schema: z.ZodType<unknown> | null;
  readonly structuredEditor: boolean;
};

function entry(
  e: Omit<PolicyConfigRegistryEntry, 'structuredEditor'> & {
    readonly structuredEditor?: boolean;
  },
): PolicyConfigRegistryEntry {
  const { structuredEditor: se, ...rest } = e;
  return {
    ...rest,
    structuredEditor: se ?? e.schema !== null,
  };
}

/** Canonical list (order = UI catalog order) */
export const POLICY_CONFIG_REGISTRY: readonly PolicyConfigRegistryEntry[] = [
  entry({
    configKey: 'intake.throttling',
    title: 'Market intake throttling',
    docPath: 'docs/intake-policy-config-keys.md',
    consumers: ['market-intake-service'],
    schema: intakeThrottlingSchema,
  }),
  entry({
    configKey: 'intake.routing.tiers',
    title: 'Intake routing tiers',
    docPath: 'docs/intake-policy-config-keys.md',
    consumers: ['market-intake-service'],
    schema: intakeRoutingTiersSchema,
  }),
  entry({
    configKey: 'paper.discovery',
    title: 'Paper discovery worker',
    docPath: 'docs/paper-discovery-config-keys.md',
    consumers: ['paper-trading-service'],
    schema: paperDiscoverySchema,
  }),
  entry({
    configKey: 'opportunity.filters',
    title: 'Opportunity gating filters',
    docPath: 'docs/opportunity-filters-config-keys.md',
    consumers: [],
    schema: opportunityFiltersSchema,
    structuredEditor: false,
  }),
  entry({
    configKey: 'risk.evaluation',
    title: 'Risk evaluation knobs',
    docPath: 'docs/policy-config-keys-catalog.md',
    consumers: [],
    schema: riskEvaluationSchema,
    structuredEditor: false,
  }),
  entry({
    configKey: 'risk.limits.bundle',
    title: 'Risk limits bundle (oversight)',
    docPath: 'docs/policy-config-keys-catalog.md',
    consumers: [],
    schema: null,
  }),
  entry({
    configKey: 'execution.plan',
    title: 'Execution plan defaults',
    docPath: 'docs/policy-config-keys-catalog.md',
    consumers: [],
    schema: executionPlanPolicySchema,
    structuredEditor: false,
  }),
  entry({
    configKey: 'capital.reservation',
    title: 'Capital reservation policy',
    docPath: 'docs/policy-config-keys-catalog.md',
    consumers: [],
    schema: capitalReservationPolicySchema,
    structuredEditor: false,
  }),
  entry({
    configKey: 'features.flags',
    title: 'Feature flags',
    docPath: 'docs/policy-config-keys-catalog.md',
    consumers: [],
    schema: featuresFlagsSchema,
    structuredEditor: false,
  }),
];

const REGISTRY_BY_KEY: ReadonlyMap<string, PolicyConfigRegistryEntry> = new Map(
  POLICY_CONFIG_REGISTRY.map((e) => [e.configKey, e]),
);

export function getRegistryEntry(
  configKey: string,
): PolicyConfigRegistryEntry | undefined {
  return REGISTRY_BY_KEY.get(configKey);
}

export function isKnownRegistryKey(configKey: string): boolean {
  return REGISTRY_BY_KEY.has(configKey);
}

function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `${i.path.length ? i.path.join('.') : 'root'}: ${i.message}`)
    .join('; ');
}

export function validateConfigJson(
  configKey: string,
  rawJson: string,
):
  | { ok: true; value: unknown; normalized: string }
  | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }

  const meta = getRegistryEntry(configKey);
  if (!meta?.schema) {
    return {
      ok: true,
      value: parsed,
      normalized: JSON.stringify(parsed),
    };
  }

  const r = meta.schema.safeParse(parsed);
  if (!r.success) {
    return { ok: false, error: formatZodError(r.error) };
  }

  return {
    ok: true,
    value: r.data,
    normalized: JSON.stringify(r.data),
  };
}
