import { Injectable, Logger } from '@nestjs/common';
import { JsonRpcProvider } from 'ethers';
import { Counter } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import {
  CHAIN_FINALITY_CONFIRMATIONS,
  getRequiredConfirmations,
} from '@arbibot/contracts-eth';

import { RpcProviderManager } from '../rpc/rpc-provider-manager.service';

// ───────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────

/** Default timeout for `waitForSourceFinality`: 10 minutes. */
const DEFAULT_FINALITY_TIMEOUT_MS = 600_000;

/** Lower-bound confirmations if env override is invalid (fail-closed conservative). */
const FALLBACK_CONFIRMATIONS = 12;

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

export interface SourceFinalityResult {
  /** Whether the source TX has reached the required confirmations. */
  readonly confirmed: boolean;
  /** Number of confirmations observed (0 if the TX is not mined yet). */
  readonly confirmations: number;
  /** Chain-specific required confirmations threshold applied. */
  readonly requiredConfirmations: number;
  /** Whether the wait timed out (TX never reached required confirmations). */
  readonly timedOut: boolean;
}

// ───────────────────────────────────────────────────────────────────────
// Service
// ───────────────────────────────────────────────────────────────────────

/**
 * Bridge finality service — chain-specific source-chain confirmation tracking.
 *
 * Step: D4-B-5-BRIDGE (L5)
 *
 * Provides:
 * - `getRequiredConfirmationsFor(chainId)` — chain-specific threshold (with env override)
 * - `getSourceConfirmations(txHash, chainId)` — current confirmation count
 * - `waitForSourceFinality(txHash, chainId)` — blocking wait with timeout
 *
 * Read-only: no key signing, no state writes. Used by bridge adapters to gate
 * `completed` on source-chain reorg safety before destination delivery is verified.
 *
 * Fail-closed: on RPC error / unknown chain, returns conservative values and never
 * claims finality prematurely.
 */
@Injectable()
export class BridgeFinalityService {
  private readonly logger = new Logger(BridgeFinalityService.name);

  /** Env override map parsed once at construction (fail-closed to defaults on parse error). */
  private readonly envOverrides: Readonly<Record<number, number>>;

  // Metrics
  private finalityCheckCounter!: Counter<string>;
  private finalityConfirmedCounter!: Counter<string>;
  private finalityTimeoutCounter!: Counter<string>;

  constructor(private readonly rpcProviderManager: RpcProviderManager) {
    this.envOverrides = parseEnvOverrides();
    this.initializeMetrics();
  }

  /**
   * Resolve the required confirmations for a chain ID.
   *
   * Applies the env override (`BRIDGE_FINALITY_CONFIRMATIONS` JSON) if present and
   * valid; otherwise falls back to `getRequiredConfirmations` from contracts-eth.
   * Env can only TIGHTEN (≥ the chain default is allowed; looser values are clamped
   * back to the default to preserve capital safety).
   */
  getRequiredConfirmationsFor(chainId: number): number {
    const chainDefault = getRequiredConfirmations(chainId);
    const envValue = this.envOverrides[chainId];
    if (envValue !== undefined) {
      // Env may only tighten (raise) the threshold — never loosen.
      return Math.max(envValue, chainDefault);
    }
    return chainDefault;
  }

  /**
   * Get the current number of confirmations for a source TX.
   *
   * Returns 0 if the TX is not mined yet or the RPC call fails (fail-closed).
   */
  async getSourceConfirmations(txHash: string, chainId: number): Promise<number> {
    if (!txHash) {
      return 0;
    }

    try {
      const provider = this.rpcProviderManager.getProvider(chainId) as JsonRpcProvider;
      const [receipt, currentBlock] = await Promise.all([
        provider.getTransactionReceipt(txHash),
        provider.getBlockNumber(),
      ]);

      if (!receipt || receipt.blockNumber == null) {
        return 0;
      }

      // confirmations = current block height − tx block (≥ 1 once mined)
      return Math.max(0, currentBlock - receipt.blockNumber);
    } catch (error) {
      this.logger.warn(
        `getSourceConfirmations: RPC error for tx=${txHash} chain=${chainId}: ${String(error)}`,
      );
      this.finalityCheckCounter.inc({ chain_id: String(chainId), result: 'rpc_error' });
      return 0;
    }
  }

  /**
   * Wait for a source TX to reach the required confirmations.
   *
   * Uses `provider.waitForTransaction(hash, confirms, timeout)`. On timeout returns
   * `{ timedOut: true, confirmed: false }` (caller — the polling worker — will then
   * escalate via `markTimedOut`). On RPC error returns the same (fail-closed).
   */
  async waitForSourceFinality(
    txHash: string,
    chainId: number,
    timeoutMs: number = DEFAULT_FINALITY_TIMEOUT_MS,
  ): Promise<SourceFinalityResult> {
    const requiredConfirmations = this.getRequiredConfirmationsFor(chainId);
    this.finalityCheckCounter.inc({
      chain_id: String(chainId),
      result: 'checked',
    });

    if (!txHash) {
      return {
        confirmed: false,
        confirmations: 0,
        requiredConfirmations,
        timedOut: true,
      };
    }

    try {
      const provider = this.rpcProviderManager.getProvider(chainId) as JsonRpcProvider;
      const receipt = await provider.waitForTransaction(txHash, requiredConfirmations, timeoutMs);

      if (!receipt) {
        this.finalityTimeoutCounter.inc({ chain_id: String(chainId) });
        return {
          confirmed: false,
          confirmations: 0,
          requiredConfirmations,
          timedOut: true,
        };
      }

      // Recompute the confirmation count for the returned receipt.
      const currentBlock = await provider.getBlockNumber();
      const confirmations = Math.max(0, currentBlock - (receipt.blockNumber ?? currentBlock));

      this.finalityConfirmedCounter.inc({ chain_id: String(chainId) });
      return {
        confirmed: confirmations >= requiredConfirmations,
        confirmations,
        requiredConfirmations,
        timedOut: false,
      };
    } catch (error) {
      this.logger.warn(
        `waitForSourceFinality: error/timeout for tx=${txHash} chain=${chainId}: ${String(error)}`,
      );
      this.finalityTimeoutCounter.inc({ chain_id: String(chainId) });
      return {
        confirmed: false,
        confirmations: 0,
        requiredConfirmations,
        timedOut: true,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────────────

  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    this.finalityCheckCounter = new Counter({
      name: 'arb_bridge_finality_checks_total',
      help: 'Bridge source-finality checks (result: checked|rpc_error)',
      labelNames: ['chain_id', 'result'],
      registers: [registry],
    });

    this.finalityConfirmedCounter = new Counter({
      name: 'arb_bridge_finality_confirmed_total',
      help: 'Bridge source-finality reached required confirmations',
      labelNames: ['chain_id'],
      registers: [registry],
    });

    this.finalityTimeoutCounter = new Counter({
      name: 'arb_bridge_finality_timeouts_total',
      help: 'Bridge source-finality wait timeouts (TX never reached required confirmations)',
      labelNames: ['chain_id'],
      registers: [registry],
    });
  }
}

// ───────────────────────────────────────────────────────────────────────
// Env-override parsing (module-private)
// ───────────────────────────────────────────────────────────────────────

/**
 * Parse the `BRIDGE_FINALITY_CONFIRMATIONS` env var as a JSON map of
 * chainId → confirmations. Fail-closed: on any parse error, returns an empty
 * object so `getRequiredConfirmationsFor` falls back to chain defaults.
 *
 * Example: `BRIDGE_FINALITY_CONFIRMATIONS='{"1":20,"42161":2}'`
 */
function parseEnvOverrides(): Readonly<Record<number, number>> {
  const raw = process.env.BRIDGE_FINALITY_CONFIRMATIONS;
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<number, number> = {};

    for (const [key, value] of Object.entries(parsed)) {
      const chainId = Number(key);
      const confirmations = Number(value);

      if (
        Number.isFinite(chainId) &&
        chainId > 0 &&
        Number.isFinite(confirmations) &&
        confirmations >= 1
      ) {
        result[chainId] = Math.floor(confirmations);
      }
    }

    return result;
  } catch {
    // Fail-closed: ignore malformed overrides, use chain defaults.
    return {};
  }
}

// Re-export for tests / consumers that import from this module.
export { CHAIN_FINALITY_CONFIRMATIONS, FALLBACK_CONFIRMATIONS };
