/**
 * Scanner-service response types (mirrors `scanner-service` HTTP API + `ScannerFindingEntity`).
 *
 * The BFF proxies `/api/operator/scanners/*` → scanner-service verbatim, so the client sees
 * the same shapes. Decimal columns (gross/net profit, fees, volume) arrive as strings because
 * TypeORM serializes `numeric`/`decimal` columns as strings to preserve precision.
 */

export type ScannerPublishStatus = 'pending' | 'published' | 'failed';

export interface ScannerInstanceSummary {
  /** Config id (e.g. `arb-2venue-1`). */
  readonly id: string;
  readonly name: string;
  readonly network: string;
  readonly strategy: string;
  readonly enabled: boolean;
}

export interface ScannerInstancesResponse {
  readonly instances: ScannerInstanceSummary[];
}

export interface ScannerFinding {
  readonly id: string;
  readonly instanceId: string;
  readonly opportunityId: string | null;
  readonly publishStatus: ScannerPublishStatus;
  readonly publishAttempts: number;
  readonly canonicalToken: string;
  readonly chainId: number;
  readonly buyVenue: string;
  readonly sellVenue: string;
  readonly buyPoolAddr: string;
  readonly sellPoolAddr: string;
  readonly spreadBps: number;
  /** Decimal serialized as string. */
  readonly grossProfitUsd: string;
  readonly netProfitUsd: string;
  readonly feesUsd: string;
  readonly volume1hUsd: string | null;
  readonly volume24hUsd: string | null;
  readonly observedAt: string;
}

export interface ScannerStatusResponse {
  readonly isShuttingDown: boolean;
  readonly scheduledInstanceIds: string[];
  readonly runningInstanceIds: string[];
}

/** Result shape for `POST /scanner/findings/:id/re-publish` and `/instances/:id/run`. */
export interface ScannerActionResult {
  readonly published?: boolean;
  readonly opportunityId?: string;
  readonly success?: boolean;
  readonly message?: string;
  readonly findingId?: string;
  readonly instanceId?: string;
}
