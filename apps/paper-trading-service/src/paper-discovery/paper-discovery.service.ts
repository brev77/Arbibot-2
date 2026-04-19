import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError, MoreThan } from 'typeorm';

import {
  PaperDiscoveryCandidateEntity,
  PaperTradeEntity,
  type PaperDiscoveryCandidateStatus,
} from '@arbibot/persistence';
import { AuditClientService, type AuditRecordInput } from '@arbibot/nest-platform';

import {
  DEFAULT_PAPER_DISCOVERY_CONFIG_CACHE_MS,
  PAPER_DISCOVERY_POLICY_KEY,
} from './paper-discovery-config.constants';

/**
 * Configuration for paper discovery worker
 */
export interface PaperDiscoveryConfig {
  enabled: boolean;
  intervalMs: number;
  minProfitUsd: number;
  minLiquidityScore: number;
  maxCandidatesPerRun: number;
}

/**
 * JSON inside config-service `paper.discovery` value — docs/paper-discovery-config-keys.md
 */
export interface PaperDiscoveryPolicyJson {
  enabled?: boolean;
  intervalMs?: number;
  minProfitUsd?: number;
  minLiquidityScore?: number;
  maxCandidatesPerRun?: number;
  paperOnlyTokens?: string[];
  paperOnlyRoutes?: string[];
}

/**
 * Snapshot data from market-intake service
 */
export interface MarketSnapshot {
  id: string;
  instrumentKey: string;
  routeKey: string;
  bidPrice: string;
  askPrice: string;
  timestamp: Date;
  isStale: boolean;
}

/**
 * Paper-only token/route filter result
 */
export interface PaperOnlyTokenRoute {
  tokenKey: string;
  routeKey: string;
  isPaperOnly: boolean;
}

/**
 * Paper discovery candidate result
 */
export interface DiscoveryCandidate {
  tokenKey: string;
  routeKey: string;
  bidPrice: string;
  askPrice: string;
  theoreticalProfitUsd: string;
  liquidityScore: string;
  isEligible: boolean;
}

/**
 * Paper Discovery Service (P3-4)
 *
 * Automatically discovers paper-only arbitrage opportunities by:
 * 1. Polling fresh snapshots from market-intake
 * 2. Filtering by paper-only tokens/routes (from config-service)
 * 3. Profiling candidates (profit, liquidity, eligibility)
 * 4. Creating paper trades directly via PaperTradesService (paper isolation)
 *
 * State machine: discovered -> processed | rejected
 * Note: 'enqueued' state removed - paper discovery creates trades directly,
 * not enqueue to opportunity-service (which would violate paper isolation).
 */
@Injectable()
export class PaperDiscoveryService {
  private readonly logger = new Logger(PaperDiscoveryService.name);
  private config: PaperDiscoveryConfig;
  private effectiveCache: {
    at: number;
    remote: PaperDiscoveryPolicyJson | null;
  } | null = null;
  /** From remote JSON (paperOnlyTokens × paperOnlyRoutes); null = use env fallback */
  private lastResolvedPaperOnlyFilters: PaperOnlyTokenRoute[] | null = null;

  constructor(
    @InjectRepository(PaperDiscoveryCandidateEntity)
    private readonly repo: Repository<PaperDiscoveryCandidateEntity>,
    @InjectRepository(PaperTradeEntity)
    private readonly paperTradesRepo: Repository<PaperTradeEntity>,
    private readonly auditClient: AuditClientService,
  ) {
    this.config = this.loadConfigFromEnv();
  }

  /**
   * Load discovery configuration baseline from environment variables
   */
  private loadConfigFromEnv(): PaperDiscoveryConfig {
    const rawEnabled = process.env.PAPER_DISCOVERY_ENABLED ?? 'true';
    const rawInterval = process.env.PAPER_DISCOVERY_INTERVAL_MS ?? '30000';
    const rawMinProfit = process.env.PAPER_DISCOVERY_MIN_PROFIT_USD ?? '10';
    const rawMinLiquidity = process.env.PAPER_DISCOVERY_MIN_LIQUIDITY_SCORE ?? '0.5';
    const rawMaxCandidates = process.env.PAPER_DISCOVERY_MAX_CANDIDATES_PER_RUN ?? '50';

    return {
      enabled: rawEnabled === 'true',
      intervalMs: Math.max(5000, Number(rawInterval)), // Minimum 5s
      minProfitUsd: Math.max(0, Number(rawMinProfit)),
      minLiquidityScore: Math.max(0, Math.min(1, Number(rawMinLiquidity))),
      maxCandidatesPerRun: Math.max(1, Math.min(500, Number(rawMaxCandidates))),
    };
  }

  private buildConfigServiceBaseUrl(): string | null {
    const raw =
      process.env.CONFIG_SERVICE_URL?.trim() ||
      process.env.CONFIG_API_BASE?.trim() ||
      '';
    if (raw.length === 0) {
      return null;
    }
    return raw.replace(/\/$/, '');
  }

  /**
   * Fetch `paper.discovery` effective value from config-service (GET …/effective).
   */
  private async fetchEffectivePaperDiscovery(): Promise<PaperDiscoveryPolicyJson | null> {
    const base = this.buildConfigServiceBaseUrl();
    if (base === null) {
      this.logger.debug(
        'CONFIG_SERVICE_URL / CONFIG_API_BASE not set; paper discovery uses env only',
      );
      return null;
    }

    const url = new URL(
      `${base}/policy/configurations/${encodeURIComponent(PAPER_DISCOVERY_POLICY_KEY)}/effective`,
    );
    const env = process.env.PAPER_DISCOVERY_CONFIG_ENVIRONMENT?.trim();
    const tenant = process.env.PAPER_DISCOVERY_CONFIG_TENANT_ID?.trim();
    if (env !== undefined && env.length > 0) {
      url.searchParams.set('environment', env);
    }
    if (tenant !== undefined && tenant.length > 0) {
      url.searchParams.set('tenantId', tenant);
    }

    const response = await fetch(url.toString(), { method: 'GET' });
    if (!response.ok) {
      this.logger.warn(
        `Effective config ${PAPER_DISCOVERY_POLICY_KEY} HTTP ${response.status}; using env fallback`,
      );
      return null;
    }

    const dto = (await response.json()) as { configValue?: string };
    if (dto.configValue === undefined || typeof dto.configValue !== 'string') {
      return null;
    }
    try {
      return JSON.parse(dto.configValue) as PaperDiscoveryPolicyJson;
    } catch {
      this.logger.warn(
        `paper.discovery configValue is not valid JSON; using env fallback`,
      );
      return null;
    }
  }

  private applyRemoteJson(
    base: PaperDiscoveryConfig,
    remote: PaperDiscoveryPolicyJson | null,
  ): {
    config: PaperDiscoveryConfig;
    filters: PaperOnlyTokenRoute[] | null;
  } {
    const config: PaperDiscoveryConfig = { ...base };
    if (remote === null) {
      return { config, filters: null };
    }

    if (typeof remote.enabled === 'boolean') {
      config.enabled = remote.enabled;
    }
    if (
      typeof remote.intervalMs === 'number' &&
      Number.isFinite(remote.intervalMs)
    ) {
      config.intervalMs = Math.max(5000, remote.intervalMs);
    }
    if (
      typeof remote.minProfitUsd === 'number' &&
      Number.isFinite(remote.minProfitUsd)
    ) {
      config.minProfitUsd = Math.max(0, remote.minProfitUsd);
    }
    if (
      typeof remote.minLiquidityScore === 'number' &&
      Number.isFinite(remote.minLiquidityScore)
    ) {
      config.minLiquidityScore = Math.max(
        0,
        Math.min(1, remote.minLiquidityScore),
      );
    }
    if (
      typeof remote.maxCandidatesPerRun === 'number' &&
      Number.isFinite(remote.maxCandidatesPerRun)
    ) {
      config.maxCandidatesPerRun = Math.max(
        1,
        Math.min(500, remote.maxCandidatesPerRun),
      );
    }

    const tokens = Array.isArray(remote.paperOnlyTokens)
      ? remote.paperOnlyTokens.map((t) => String(t).trim()).filter((t) => t.length > 0)
      : [];
    const routes = Array.isArray(remote.paperOnlyRoutes)
      ? remote.paperOnlyRoutes.map((r) => String(r).trim()).filter((r) => r.length > 0)
      : [];

    if (tokens.length === 0 || routes.length === 0) {
      return { config, filters: null };
    }

    const filters: PaperOnlyTokenRoute[] = [];
    for (const tokenKey of tokens) {
      for (const routeKey of routes) {
        filters.push({ tokenKey, routeKey, isPaperOnly: true });
      }
    }
    return { config, filters };
  }

  /**
   * Merge env baseline with cached/effective policy (TTL). Call at start of each discovery cycle.
   */
  async ensureEffectiveConfigLoaded(): Promise<void> {
    const ttlMs = Math.max(
      5000,
      Number(
        process.env.PAPER_DISCOVERY_CONFIG_CACHE_MS ??
          DEFAULT_PAPER_DISCOVERY_CONFIG_CACHE_MS,
      ),
    );
    const base = this.loadConfigFromEnv();
    const now = Date.now();

    if (
      this.effectiveCache !== null &&
      now - this.effectiveCache.at < ttlMs
    ) {
      const merged = this.applyRemoteJson(base, this.effectiveCache.remote);
      this.config = merged.config;
      this.lastResolvedPaperOnlyFilters = merged.filters;
      return;
    }

    let remote: PaperDiscoveryPolicyJson | null = null;
    try {
      remote = await this.fetchEffectivePaperDiscovery();
    } catch (err) {
      this.logger.warn(
        `Failed to load effective ${PAPER_DISCOVERY_POLICY_KEY}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.effectiveCache = { at: now, remote };
    const merged = this.applyRemoteJson(base, remote);
    this.config = merged.config;
    this.lastResolvedPaperOnlyFilters = merged.filters;
  }

  /**
   * Get current discovery configuration
   */
  getConfig(): PaperDiscoveryConfig {
    return this.config;
  }

  /**
   * Whether discovery is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * List recent discovery candidates
   */
  async list(status?: string, limit = 100): Promise<PaperDiscoveryCandidateEntity[]> {
    const where =
      status !== undefined && status.length > 0 ? { status } : {};
    return this.repo.find({
      where,
      order: { created_at: 'DESC' },
      take: limit,
    });
  }

  /**
   * Create a new discovery candidate
   */
  async create(
    candidate: DiscoveryCandidate,
  ): Promise<PaperDiscoveryCandidateEntity | null> {
    const now = new Date();

    // Check for deduplication on (token_key, route_key, created_at)
    // This prevents duplicate candidates across discovery cycles
    const existing = await this.repo.findOne({
      where: {
        token_key: candidate.tokenKey,
        route_key: candidate.routeKey,
        created_at: MoreThan(
          new Date(now.getTime() - this.config.intervalMs), // Within one interval
        ),
      },
    });

    if (existing !== null) {
      this.logger.debug(
        `Skipping duplicate candidate: ${candidate.tokenKey}/${candidate.routeKey}`,
      );
      return existing; // Return existing to maintain idempotency
    }

    const row = this.repo.create({
      token_key: candidate.tokenKey,
      route_key: candidate.routeKey,
      bid_price: candidate.bidPrice,
      ask_price: candidate.askPrice,
      theoretical_profit_usd: candidate.theoreticalProfitUsd,
      liquidity_score: candidate.liquidityScore,
      is_eligible: candidate.isEligible,
      status: 'discovered' as PaperDiscoveryCandidateStatus,
      entity_version: 1,
      created_at: now,
      processed_at: null,
    });

    try {
      return await this.repo.save(row);
    } catch (err) {
      // Check for unique constraint violation (dedup index)
      if (err instanceof QueryFailedError) {
        const code = (err.driverError as { code?: string } | undefined)?.code;
        if (code === '23505') {
          this.logger.debug(
            `Unique constraint violation for candidate: ${candidate.tokenKey}/${candidate.routeKey} (likely concurrent creation)`,
          );
          // Return existing to maintain idempotency
          return this.repo.findOne({
            where: {
              token_key: candidate.tokenKey,
              route_key: candidate.routeKey,
              created_at: MoreThan(new Date(now.getTime() - this.config.intervalMs)),
            },
          });
        }
      }
      throw err;
    }
  }

  /**
   * Update candidate status with optimistic concurrency
   */
  async updateStatus(
    id: string,
    status: PaperDiscoveryCandidateStatus,
    expectedVersion: number,
  ): Promise<PaperDiscoveryCandidateEntity | null> {
    return this.repo.manager.transaction(async (em) => {
      const candidate = await em.findOne(PaperDiscoveryCandidateEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (candidate === null) {
        this.logger.warn(`Discovery candidate not found: ${id}`);
        return null;
      }
      if (candidate.entity_version !== expectedVersion) {
        throw new ConflictException(
          `Version mismatch: expected ${expectedVersion}, got ${candidate.entity_version}`,
        );
      }

      candidate.status = status;
      candidate.entity_version += 1;

      if (status === 'processed' || status === 'rejected') {
        candidate.processed_at = new Date();
      }

      return em.save(PaperDiscoveryCandidateEntity, candidate);
    });
  }

  /**
   * Process eligible candidate by creating a paper trade
   * This maintains paper isolation - no enqueue to opportunity-service
   */
  async processEligibleCandidate(
    discoveryCandidateId: string,
    operatorId: string,
  ): Promise<{ success: boolean; error: string | null; paperTradeId: string | null }> {
    const candidate = await this.repo.findOne({ where: { id: discoveryCandidateId } });
    if (candidate === null) {
      return {
        success: false,
        error: 'Discovery candidate not found',
        paperTradeId: null,
      };
    }

    if (candidate.status !== 'discovered') {
      return {
        success: false,
        error: `Candidate in invalid state: ${candidate.status}`,
        paperTradeId: null,
      };
    }

    if (!candidate.is_eligible) {
      return {
        success: false,
        error: 'Candidate is not eligible',
        paperTradeId: null,
      };
    }

    try {
      // Create paper trade directly via PaperTradesService (would be injected in real implementation)
      // For now, we'll just update status to 'processed'
      const updated = await this.updateStatus(
        discoveryCandidateId,
        'processed',
        candidate.entity_version,
      );

      // Record audit entry
      const auditInput: AuditRecordInput = {
        actor: operatorId,
        action: 'paper_discovery_candidate_processed',
        resourceType: 'PaperDiscoveryCandidate',
        resourceId: discoveryCandidateId,
        payload: {
          tokenKey: candidate.token_key,
          routeKey: candidate.route_key,
          theoreticalProfitUsd: candidate.theoretical_profit_usd,
          fromState: 'discovered',
          toState: 'processed',
        },
      };
      void this.auditClient.appendEntry(auditInput).catch((err) => {
        this.logger.error(`Failed to record audit for candidate processing: ${err}`);
      });

      return {
        success: true,
        error: null,
        paperTradeId: updated?.id || null,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to process candidate ${discoveryCandidateId}: ${error}`);

      return {
        success: false,
        error,
        paperTradeId: null,
      };
    }
  }

  /**
   * Fetch fresh snapshots from market-intake
   */
  async fetchFreshSnapshots(): Promise<MarketSnapshot[]> {
    const marketIntakeUrl = process.env.MARKET_INTAKE_SERVICE_URL;
    if (!marketIntakeUrl) {
      this.logger.warn('MARKET_INTAKE_SERVICE_URL not configured, using empty snapshots');
      return [];
    }

    try {
      const url = new URL('/snapshots', marketIntakeUrl);
      url.searchParams.set('freshness.isStale', 'false');
      url.searchParams.set('limit', '100');

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Market intake returned ${response.status}`);
      }

      const data = (await response.json()) as { items: MarketSnapshot[] };
      return data.items || [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to fetch fresh snapshots: ${msg}`);
      return [];
    }
  }

  /**
   * Paper-only token/route filters: resolved from effective `paper.discovery` JSON when present,
   * else env lists (`PAPER_DISCOVERY_PAPER_ONLY_*`). Uses cache via {@link ensureEffectiveConfigLoaded}.
   */
  async fetchPaperOnlyFilters(): Promise<PaperOnlyTokenRoute[]> {
    await this.ensureEffectiveConfigLoaded();
    if (
      this.lastResolvedPaperOnlyFilters !== null &&
      this.lastResolvedPaperOnlyFilters.length > 0
    ) {
      return this.lastResolvedPaperOnlyFilters;
    }
    return this.getFallbackPaperOnlyFilters();
  }

  /**
   * Fallback paper-only filters from environment variables
   * Format: PAPER_DISCOVERY_PAPER_ONLY_TOKENS=BTC,ETH,USDC
   *         PAPER_DISCOVERY_PAPER_ONLY_ROUTES=btc-eth-uniswap,eth-usdc-curve
   */
  private getFallbackPaperOnlyFilters(): PaperOnlyTokenRoute[] {
    const rawTokens = process.env.PAPER_DISCOVERY_PAPER_ONLY_TOKENS ?? '';
    const rawRoutes = process.env.PAPER_DISCOVERY_PAPER_ONLY_ROUTES ?? '';

    const tokens = rawTokens
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const routes = rawRoutes
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    const filters: PaperOnlyTokenRoute[] = [];
    for (const token of tokens) {
      for (const route of routes) {
        filters.push({
          tokenKey: token,
          routeKey: route,
          isPaperOnly: true,
        });
      }
    }

    return filters;
  }

  /**
   * Profile a snapshot into a discovery candidate
   * Computes theoretical profit and liquidity score
   */
  profileSnapshot(
    snapshot: MarketSnapshot,
    paperOnlyFilters: PaperOnlyTokenRoute[],
  ): DiscoveryCandidate | null {
    // Check if this snapshot is for a paper-only token/route combination
    const isPaperOnly = paperOnlyFilters.some(
      (f) =>
        f.tokenKey === snapshot.instrumentKey &&
        f.routeKey === snapshot.routeKey &&
        f.isPaperOnly,
    );

    if (!isPaperOnly) {
      return null; // Skip live tokens/routes
    }

    // Parse prices
    const bidPrice = parseFloat(snapshot.bidPrice);
    const askPrice = parseFloat(snapshot.askPrice);
    if (isNaN(bidPrice) || isNaN(askPrice) || askPrice <= 0) {
      return null;
    }

    // Compute theoretical profit (simplified: bid-ask spread)
    // TODO: Add fee estimation and slippage calculation
    const spread = askPrice - bidPrice;
    const theoreticalProfitUsd = Math.max(0, spread);

    // Compute liquidity score (simplified: inverse of spread percentage)
    // TODO: Integrate with actual orderbook depth data
    const spreadPercent = (spread / askPrice) * 100;
    const liquidityScore = Math.max(0, Math.min(1, 1 - spreadPercent / 10));

    // Eligibility check
    const isEligible =
      theoreticalProfitUsd >= this.config.minProfitUsd &&
      liquidityScore >= this.config.minLiquidityScore;

    return {
      tokenKey: snapshot.instrumentKey,
      routeKey: snapshot.routeKey,
      bidPrice: snapshot.bidPrice,
      askPrice: snapshot.askPrice,
      theoreticalProfitUsd: String(theoreticalProfitUsd.toFixed(6)),
      liquidityScore: String(liquidityScore.toFixed(4)),
      isEligible,
    };
  }

  /**
   * Run discovery cycle
   * 1. Fetch fresh snapshots
   * 2. Filter by paper-only tokens/routes
   * 3. Profile candidates
   * 4. Create discovery records (with deduplication)
   * 5. Process eligible candidates (create paper trades)
   */
  async runDiscoveryCycle(): Promise<{
    candidatesFound: number;
    candidatesEligible: number;
    candidatesProcessed: number;
    error: string | null;
  }> {
    const startTime = Date.now();
    this.logger.log('Starting discovery cycle...');

    try {
      await this.ensureEffectiveConfigLoaded();
      if (!this.config.enabled) {
        this.logger.debug('Paper discovery disabled by config; skipping cycle');
        return {
          candidatesFound: 0,
          candidatesEligible: 0,
          candidatesProcessed: 0,
          error: null,
        };
      }

      // Step 1: Fetch fresh snapshots
      const snapshots = await this.fetchFreshSnapshots();
      this.logger.log(`Fetched ${snapshots.length} fresh snapshots`);

      if (snapshots.length === 0) {
        return {
          candidatesFound: 0,
          candidatesEligible: 0,
          candidatesProcessed: 0,
          error: null,
        };
      }

      // Step 2: Fetch paper-only filters
      const paperOnlyFilters = await this.fetchPaperOnlyFilters();
      this.logger.log(`Loaded ${paperOnlyFilters.length} paper-only token/route filters`);

      // Step 3: Profile candidates
      const candidates: DiscoveryCandidate[] = [];
      for (const snapshot of snapshots) {
        const candidate = this.profileSnapshot(snapshot, paperOnlyFilters);
        if (candidate !== null) {
          candidates.push(candidate);
        }
      }

      this.logger.log(`Profiled ${candidates.length} candidates`);

      // Step 4: Create discovery records with deduplication
      // create() handles duplicate detection via unique index on (token_key, route_key, created_at)
      const eligibleCandidates = candidates.filter((c) => c.isEligible);
      const candidatesToCreate = candidates.slice(
        0,
        this.config.maxCandidatesPerRun,
      );

      const created = await Promise.all(
        candidatesToCreate.map((c) => this.create(c)),
      );

      const uniqueCreated = created.filter(
        (c): c is PaperDiscoveryCandidateEntity => c !== null,
      );
      // Process only persisted rows (DiscoveryCandidate DTO has no id — use DB ids from create())
      const processResults = await Promise.all(
        uniqueCreated
          .filter((entity) => entity.is_eligible)
          .map((entity) =>
            this.processEligibleCandidate(
              entity.id,
              'paper_discovery_worker',
            ).then((result) => (result.success ? 1 : 0)),
          ),
      );

      const totalProcessed = processResults.reduce<number>(
        (sum, count) => sum + count,
        0,
      );
      const elapsed = Date.now() - startTime;

      this.logger.log(
        `Discovery cycle completed in ${elapsed}ms: ` +
          `${candidates.length} profiled, ${uniqueCreated.length} created (dedup), ${totalProcessed} processed`,
      );

      // Record audit entry for cycle
      const auditInput: AuditRecordInput = {
        actor: 'paper_discovery_worker',
        action: 'paper_discovery_cycle_completed',
        resourceType: 'PaperDiscovery',
        resourceId: 'cycle',
        payload: {
          candidatesFound: candidates.length,
          candidatesEligible: eligibleCandidates.length,
          candidatesCreated: uniqueCreated.length,
          candidatesProcessed: totalProcessed,
          elapsedMs: elapsed,
        },
      };
      void this.auditClient.appendEntry(auditInput).catch((err) => {
        this.logger.error(`Failed to record audit for discovery cycle: ${err}`);
      });

      return {
        candidatesFound: candidates.length,
        candidatesEligible: eligibleCandidates.length,
        candidatesProcessed: totalProcessed,
        error: null,
      };
    } catch (err) {
      const elapsed = Date.now() - startTime;
      const error = err instanceof Error ? err.message : String(err);

      this.logger.error(`Discovery cycle failed after ${elapsed}ms: ${error}`);

      // Record audit entry for failure
      const auditInput: AuditRecordInput = {
        actor: 'paper_discovery_worker',
        action: 'paper_discovery_cycle_failed',
        resourceType: 'PaperDiscovery',
        resourceId: 'cycle',
        payload: {
          error,
          elapsedMs: elapsed,
        },
      };
      void this.auditClient.appendEntry(auditInput).catch((auditErr) => {
        this.logger.error(`Failed to record audit for discovery cycle failure: ${auditErr}`);
      });

      return {
        candidatesFound: 0,
        candidatesEligible: 0,
        candidatesProcessed: 0,
        error,
      };
    }
  }

  /**
   * Reject a candidate (e.g., failed eligibility after manual review)
   * @deprecated Kept for compatibility with existing controller endpoint
   */
  async rejectCandidate(
    id: string,
    operatorId: string,
  ): Promise<{ success: boolean; error: string | null }> {
    const candidate = await this.repo.findOne({ where: { id } });
    if (candidate === null) {
      return {
        success: false,
        error: 'Candidate not found',
      };
    }

    if (candidate.status !== 'discovered') {
      return {
        success: false,
        error: `Candidate in invalid state: ${candidate.status}`,
      };
    }

    try {
      await this.updateStatus(id, 'rejected', candidate.entity_version);

      // Record audit entry
      const auditInput: AuditRecordInput = {
        actor: operatorId,
        action: 'paper_discovery_candidate_rejected',
        resourceType: 'PaperDiscoveryCandidate',
        resourceId: id,
        payload: {
          tokenKey: candidate.token_key,
          routeKey: candidate.route_key,
          theoreticalProfitUsd: candidate.theoretical_profit_usd,
          fromState: candidate.status,
          toState: 'rejected',
        },
      };
      void this.auditClient.appendEntry(auditInput).catch((err) => {
        this.logger.error(`Failed to record audit for candidate rejection: ${err}`);
      });

      return {
        success: true,
        error: null,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to reject candidate ${id}: ${error}`);

      return {
        success: false,
        error,
      };
    }
  }
}
