import { Injectable, Logger } from '@nestjs/common';
import { Counter } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import type { BridgeAdapter } from './bridge-adapter.interface';
import { AcrossBridgeAdapter } from './across-bridge.adapter';
import { StargateBridgeAdapter } from './stargate-bridge.adapter';
import { NativeBridgeAdapter } from './native-bridge.adapter';

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

/** Known bridge keys for adapter routing. */
export type BridgeKey = 'across' | 'stargate' | 'native';

/** All recognised bridge keys. */
const BRIDGE_KEYS: ReadonlySet<string> = new Set<string>([
  'across',
  'stargate',
  'native',
]);

// ───────────────────────────────────────────────────────────────────────
// Bridge params extraction
// ───────────────────────────────────────────────────────────────────────

/**
 * Bridge parameters extracted from plan playbook config for a specific leg.
 */
export interface BridgeLegParams {
  readonly bridgeKey: string;
  readonly sourceChainId: number;
  readonly destinationChainId: number;
  readonly token: string;
  readonly destinationToken: string;
  readonly amount: bigint;
  readonly recipientAddress: string;
}

/**
 * Extract bridge parameters from plan/leg metadata.
 *
 * Priority:
 * 1. `plan.playbookConfig.dexSwaps[leg.legIndex]` (leg-level)
 * 2. `plan.playbookConfig.bridgeDefaults` (plan-level defaults)
 *
 * Returns `undefined` if no bridge config found.
 */
export function extractBridgeParams(
  playbookConfig: Record<string, unknown> | null | undefined,
  legIndex: number,
  planId: string,
  legId: string,
): BridgeLegParams | undefined {
  if (!playbookConfig || typeof playbookConfig !== 'object') {
    return undefined;
  }

  // ── Multi-leg config (DEX-2-2-PLAN) ──────────────────────────────────
  // Format: playbookConfig.legs[legIndex] with bridgeKey, chainId, destinationChainId, token, ...
  const legs = playbookConfig.legs;
  if (Array.isArray(legs)) {
    const legEntry = legs[legIndex];
    if (legEntry && typeof legEntry === 'object') {
      const entry = legEntry as Record<string, unknown>;
      // Only consider if legType is 'bridge' or bridgeKey is set
      if (
        (typeof entry.bridgeKey === 'string' && entry.bridgeKey.length > 0) ||
        entry.legType === 'bridge'
      ) {
        // Map multi-leg config fields to bridge params
        const mapped: Record<string, unknown> = {
          bridgeKey: entry.bridgeKey,
          sourceChainId: entry.chainId ?? entry.sourceChainId,
          destinationChainId: entry.destinationChainId,
          token: entry.token ?? entry.tokenAddress,
          destinationToken: entry.destinationToken ?? entry.destinationTokenAddress,
          amount: entry.amount,
          recipientAddress: entry.recipientAddress ?? entry.recipient,
        };
        const result = validateAndBuildBridgeParams(mapped, planId, legId);
        if (result) return result;
      }
    }
  }

  // ── Legacy dexSwaps format ───────────────────────────────────────────
  const dexSwaps = playbookConfig.dexSwaps;
  if (Array.isArray(dexSwaps)) {
    const legParams = dexSwaps[legIndex];
    if (legParams && typeof legParams === 'object') {
      const bridgeKey = (legParams as Record<string, unknown>).bridgeKey;
      if (typeof bridgeKey === 'string' && bridgeKey.length > 0) {
        return validateAndBuildBridgeParams(
          legParams as Record<string, unknown>,
          planId,
          legId,
        );
      }
    }
  }

  // Plan-level defaults
  const bridgeDefaults = playbookConfig.bridgeDefaults;
  if (bridgeDefaults && typeof bridgeDefaults === 'object') {
    return validateAndBuildBridgeParams(
      bridgeDefaults as Record<string, unknown>,
      planId,
      legId,
    );
  }

  return undefined;
}

function validateAndBuildBridgeParams(
  params: Record<string, unknown>,
  _planId: string,
  _legId: string,
): BridgeLegParams | undefined {
  const bridgeKey = asString(params.bridgeKey);
  const sourceChainId = asNumber(params.sourceChainId);
  const destinationChainId = asNumber(params.destinationChainId);
  const token = asString(params.token) ?? asString(params.tokenAddress);
  const destinationToken = asString(params.destinationToken) ?? asString(params.destinationTokenAddress);
  const amountStr = asString(params.amount);
  const recipientAddress = asString(params.recipientAddress) ?? asString(params.recipient);

  if (!bridgeKey || !sourceChainId || !destinationChainId || !token || !destinationToken || !amountStr) {
    return undefined;
  }

  let amount: bigint;
  try {
    amount = BigInt(amountStr);
  } catch {
    return undefined;
  }

  return {
    bridgeKey,
    sourceChainId,
    destinationChainId,
    token,
    destinationToken,
    amount,
    recipientAddress: recipientAddress ?? '',
  };
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

// ───────────────────────────────────────────────────────────────────────
// Service
// ───────────────────────────────────────────────────────────────────────

/**
 * Bridge adapter factory — resolves `BridgeAdapter` instances by bridge key.
 *
 * Step: DEX-2-1-BRIDGE-ACROSS
 *
 * Similar to `VenueFactoryService` but for cross-chain bridge adapters.
 * The factory holds all registered bridge adapters and routes by `bridgeKey`.
 */
@Injectable()
export class BridgeAdapterFactoryService {
  private readonly logger = new Logger(BridgeAdapterFactoryService.name);

  private routeCounter!: Counter<string>;

  /** Registered bridge adapters, indexed by bridgeKey. */
  private readonly adapters = new Map<string, BridgeAdapter>();

  constructor(
    private readonly acrossAdapter: AcrossBridgeAdapter,
    private readonly stargateAdapter: StargateBridgeAdapter,
    private readonly nativeAdapter: NativeBridgeAdapter,
  ) {
    this.registerAdapter(acrossAdapter);
    this.registerAdapter(stargateAdapter);
    this.registerAdapter(nativeAdapter);
    this.initializeMetrics();
  }

  /**
   * Resolve a `BridgeAdapter` for the given bridge key.
   *
   * Throws if the bridge key is not recognized or no adapter is registered.
   */
  resolveAdapter(bridgeKey: string): BridgeAdapter {
    const adapter = this.adapters.get(bridgeKey);
    if (adapter) {
      return adapter;
    }

    if (!BRIDGE_KEYS.has(bridgeKey)) {
      throw new Error(
        `BridgeAdapterFactory: unknown bridgeKey "${bridgeKey}". ` +
        `Known keys: ${[...BRIDGE_KEYS].join(', ')}`,
      );
    }

    throw new Error(
      `BridgeAdapterFactory: bridge "${bridgeKey}" is recognized but has no adapter registered`,
    );
  }

  /**
   * Get all registered bridge keys.
   */
  getRegisteredBridgeKeys(): string[] {
    return [...this.adapters.keys()];
  }

  /**
   * Check if a bridge key has a registered adapter.
   */
  hasAdapter(bridgeKey: string): boolean {
    return this.adapters.has(bridgeKey);
  }

  /**
   * Get all registered adapters (for polling worker).
   */
  getAllAdapters(): ReadonlyMap<string, BridgeAdapter> {
    return this.adapters;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────────────

  private registerAdapter(adapter: BridgeAdapter): void {
    this.adapters.set(adapter.bridgeKey, adapter);
    this.logger.log(`Registered bridge adapter: ${adapter.bridgeKey}`);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Metrics
  // ─────────────────────────────────────────────────────────────────────

  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    this.routeCounter = new Counter({
      name: 'arb_bridge_factory_route_total',
      help: 'Total bridge adapter routing decisions',
      labelNames: ['bridge_key'],
      registers: [registry],
    });
  }
}