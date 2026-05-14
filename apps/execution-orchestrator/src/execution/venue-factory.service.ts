import { Injectable, Logger } from '@nestjs/common';
import { Counter } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import type { ExecutionLegEntity, ExecutionPlanEntity } from '@arbibot/persistence';

import type { VenueAdapter, VenueLegSubmitResult } from '../venue/venue-adapter';
import { VenueSubmitClientError } from '../venue/venue-adapter';
import { HttpVenueAdapter } from '../venue/http-venue.adapter';
import { MockVenueAdapter } from '../venue/mock-venue.adapter';
import { UniswapV2Adapter } from './adapters/uniswap-v2.adapter';
import { UniswapV3Adapter } from './adapters/uniswap-v3.adapter';
import { SushiSwapV2Adapter } from './adapters/sushiswap-v2.adapter';
import { PancakeSwapV2Adapter } from './adapters/pancakeswap-v2.adapter';
import { BiswapV2Adapter } from './adapters/biswap-v2.adapter';
import { PaperDexAdapter } from './adapters/paper-dex.adapter';

// ───────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────

/**
 * Known venue keys for adapter routing.
 *
 * - DEX keys: `uniswap-v2`, `uniswap-v3` — require `DEX_VENUE_ENABLED=true`
 * - Legacy keys: `http`, `mock` — always available
 * - `auto` / unset — legacy fallback (Mock or HTTP based on env)
 */
export type DexVenueKey = 'uniswap-v2' | 'uniswap-v3' | 'sushiswap' | 'pancakeswap-v2' | 'biswap';
export type LegacyVenueKey = 'http' | 'mock';
export type VenueKey = DexVenueKey | LegacyVenueKey | 'auto';

/** All recognised DEX venue keys. */
const DEX_VENUE_KEYS: ReadonlySet<string> = new Set<string>([
  'uniswap-v2',
  'uniswap-v3',
  'sushiswap',
  'pancakeswap-v2',
  'biswap',
]);

/** Paper / simulation venue keys — always available (no DEX_VENUE_ENABLED required). */
const PAPER_VENUE_KEYS: ReadonlySet<string> = new Set<string>([
  'paper-dex',
]);

// ───────────────────────────────────────────────────────────────────────
// Venue key extraction
// ───────────────────────────────────────────────────────────────────────

/**
 * Extract venue key from plan/leg metadata.
 *
 * Priority:
 * 1. `plan.playbookConfig.dexSwaps[leg.legIndex].venueKey` (leg-level)
 * 2. `plan.playbookConfig.venueKey` (plan-level default)
 * 3. `undefined` (no key → legacy fallback)
 */
export function extractVenueKey(
  plan: ExecutionPlanEntity,
  leg: ExecutionLegEntity,
): string | undefined {
  const config = plan.playbookConfig;
  if (!config || typeof config !== 'object') {
    return undefined;
  }

  // Leg-level override
  const dexSwaps = config.dexSwaps;
  if (Array.isArray(dexSwaps)) {
    const legParams = dexSwaps[leg.legIndex];
    if (legParams && typeof legParams === 'object' && 'venueKey' in legParams) {
      const vk = (legParams as Record<string, unknown>).venueKey;
      if (typeof vk === 'string' && vk.length > 0) {
        return vk;
      }
    }
  }

  // Plan-level default
  if ('venueKey' in config) {
    const vk = config.venueKey;
    if (typeof vk === 'string' && vk.length > 0) {
      return vk;
    }
  }

  return undefined;
}

// ───────────────────────────────────────────────────────────────────────
// Service
// ───────────────────────────────────────────────────────────────────────

/**
 * Venue adapter factory — routes `submitLeg` to the correct adapter
 * based on `venueKey` from plan/leg metadata.
 *
 * **Step:** DEX-1-1-VENUE-BIND
 *
 * When no `venueKey` is set (legacy plans), falls back to:
 * - `HttpVenueAdapter` when `VENUE_HTTP_BASE_URL` is set
 * - `MockVenueAdapter` otherwise
 *
 * DEX adapters require `DEX_VENUE_ENABLED=true`.
 */
@Injectable()
export class VenueFactoryService implements VenueAdapter {
  private readonly logger = new Logger(VenueFactoryService.name);

  private routeCounter!: Counter<string>;

  /** Lazy-initialised HTTP adapter (only when VENUE_HTTP_BASE_URL is set). */
  private httpAdapter: HttpVenueAdapter | null = null;

  constructor(
    private readonly mockAdapter: MockVenueAdapter,
    private readonly uniV2Adapter: UniswapV2Adapter,
    private readonly uniV3Adapter: UniswapV3Adapter,
    private readonly sushiAdapter: SushiSwapV2Adapter,
    private readonly pancakeV2Adapter: PancakeSwapV2Adapter,
    private readonly biswapAdapter: BiswapV2Adapter,
    private readonly paperDexAdapter: PaperDexAdapter,
  ) {
    this.initializeMetrics();
  }

  /**
   * Submit a leg by routing to the appropriate adapter.
   *
   * Resolution order:
   * 1. Extract `venueKey` from `plan.playbookConfig`
   * 2. If key is a DEX key → check `DEX_VENUE_ENABLED` → route to DEX adapter
   * 3. If key is `http` or `mock` → route to legacy adapter
   * 4. If no key → legacy fallback (HTTP if configured, else Mock)
   */
  async submitLeg(
    plan: ExecutionPlanEntity,
    leg: ExecutionLegEntity,
  ): Promise<VenueLegSubmitResult> {
    const venueKey = extractVenueKey(plan, leg);

    const adapter = this.resolveAdapter(venueKey);

    this.routeCounter.inc({ venue_key: venueKey ?? 'legacy' });

    this.logger.log(
      `submitLeg: plan=${plan.id} leg=${leg.id} venueKey=${venueKey ?? 'legacy'} adapter=${adapter.constructor.name}`,
    );

    return adapter.submitLeg(plan, leg);
  }

  /**
   * Resolve a `VenueAdapter` for the given venue key.
   *
   * Visible for testing.
   */
  resolveAdapter(venueKey: string | undefined): VenueAdapter {
    if (!venueKey) {
      return this.resolveLegacyAdapter();
    }

    // Paper / simulation adapter routing (no DEX_VENUE_ENABLED required)
    if (PAPER_VENUE_KEYS.has(venueKey)) {
      return this.resolvePaperAdapter(venueKey);
    }

    // DEX adapter routing
    if (DEX_VENUE_KEYS.has(venueKey)) {
      return this.resolveDexAdapter(venueKey as DexVenueKey);
    }

    // Explicit legacy keys
    if (venueKey === 'http') {
      return this.getOrCreateHttpAdapter();
    }
    if (venueKey === 'mock') {
      return this.mockAdapter;
    }

    // Unknown key
    throw new VenueSubmitClientError(
      `VenueFactory: unknown venueKey "${venueKey}". ` +
      `Known keys: ${[...DEX_VENUE_KEYS, ...PAPER_VENUE_KEYS, 'http', 'mock'].join(', ')}`,
      { category: 'validation' },
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Internal
  // ─────────────────────────────────────────────────────────────────────

  private resolvePaperAdapter(key: string): VenueAdapter {
    if (key === 'paper-dex') {
      return this.paperDexAdapter;
    }
    throw new VenueSubmitClientError(
      `VenueFactory: paper venue ${key} is recognised but has no adapter registered`,
      { category: 'validation' },
    );
  }

  private resolveDexAdapter(key: DexVenueKey): VenueAdapter {
    const dexEnabled = process.env.DEX_VENUE_ENABLED === 'true';
    if (!dexEnabled) {
      throw new VenueSubmitClientError(
        `VenueFactory: DEX venue "${String(key)}" requested but DEX_VENUE_ENABLED is not "true". ` +
        `Set DEX_VENUE_ENABLED=true to enable on-chain adapters.`,
        { category: 'validation' },
      );
    }

    switch (key) {
      case 'uniswap-v2':
        return this.uniV2Adapter;
      case 'uniswap-v3':
        return this.uniV3Adapter;
      case 'sushiswap':
        return this.sushiAdapter;
      case 'pancakeswap-v2':
        return this.pancakeV2Adapter;
      case 'biswap':
        return this.biswapAdapter;
      default:
        throw new VenueSubmitClientError(
          `VenueFactory: DEX venue ${String(key)} is recognised but has no adapter registered`,
          { category: 'validation' },
        );
    }
  }

  private resolveLegacyAdapter(): VenueAdapter {
    const base = process.env.VENUE_HTTP_BASE_URL?.trim() ?? '';
    if (base.length > 0) {
      return this.getOrCreateHttpAdapter();
    }
    return this.mockAdapter;
  }

  private getOrCreateHttpAdapter(): HttpVenueAdapter {
    if (!this.httpAdapter) {
      const base = process.env.VENUE_HTTP_BASE_URL?.trim() ?? '';
      if (base.length === 0) {
        throw new VenueSubmitClientError(
          'VenueFactory: HTTP venue requested but VENUE_HTTP_BASE_URL is not set',
          { category: 'validation' },
        );
      }
      this.httpAdapter = new HttpVenueAdapter(base);
    }
    return this.httpAdapter;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Metrics
  // ─────────────────────────────────────────────────────────────────────

  private initializeMetrics(): void {
    const registry = getArbibotMetricsRegistry();

    this.routeCounter = new Counter({
      name: 'arb_venue_factory_route_total',
      help: 'Total venue adapter routing decisions',
      labelNames: ['venue_key'],
      registers: [registry],
    });
  }
}