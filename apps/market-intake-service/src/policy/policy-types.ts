/** Parsed `intake.throttling` JSON from config-service (optional). */
export type IntakeThrottlingConfig = {
  readonly requireAuditOnThrottle?: boolean;
  readonly warmSampleIntervalMs?: number;
  readonly coldSampleIntervalMs?: number;
  /** Reject (throttle) when latest route score is below this (0–1). */
  readonly minRouteScore?: number;
};

/** Parsed `intake.routing.tiers` JSON — operator routing buckets (Phase 4). */
export type IntakeRoutingTiersConfig = {
  readonly hot?: { readonly enabled?: boolean; readonly instrumentKeys?: string[] };
  readonly warm?: { readonly enabled?: boolean; readonly instrumentKeys?: string[] };
  readonly cold?: { readonly enabled?: boolean; readonly instrumentKeys?: string[] };
};

export type PolicyBundle = {
  readonly throttle: IntakeThrottlingConfig | null;
  readonly routing: IntakeRoutingTiersConfig | null;
  readonly watchlistItems: ReadonlyArray<{
    readonly instrumentKey: string;
    readonly tier: string;
  }>;
  readonly routeScoreByKey: ReadonlyMap<string, number>;
  readonly fetchedAtMs: number;
  readonly fallbackMode: boolean;
};
