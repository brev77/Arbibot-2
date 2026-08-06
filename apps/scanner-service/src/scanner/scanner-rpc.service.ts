import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { FallbackProvider, JsonRpcProvider, Network, Provider } from 'ethers';
import { Counter, Gauge, Histogram } from 'prom-client';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { ChainId } from '@arbibot/contracts-eth';

import { DEFAULT_SCANNER_RPC_RATE_LIMIT_RPS } from './scanner-config.constants';

/**
 * Pin a FallbackProvider's network detection to a fixed chainId.
 *
 * Same fix as execution-orchestrator's pinFallbackNetwork (commit 6b583ba): ethers v6
 * FallbackProvider._detectNetwork bypasses the child staticNetwork pin via a live
 * eth_chainId to each child, which triggers `NETWORK_ERROR: network changed: 1 => 42161`
 * on load-balancer drift (BlockPi + public backup). This patch returns Network.from(chainId)
 * without any RPC so detection cannot fail. See PLAN11 §10.
 */
function pinFallbackNetwork(fb: FallbackProvider, chainId: number): FallbackProvider {
  const pinned = Network.from(chainId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fb as any)._detectNetwork = async () => pinned;
  return fb;
}
import { TokenBucket } from './token-bucket';

/** Maps a supported chain id to the env-var network token (ARBITRUM/BASE/BNB/ETHEREUM/OPTIMISM). */
const CHAIN_ID_TO_RPC_NETWORK = new Map<number, string>([
  [ChainId.ARBITRUM_ONE_MAINNET, 'ARBITRUM'],
  [ChainId.BASE_MAINNET, 'BASE'],
  [ChainId.BNB_CHAIN_MAINNET, 'BNB'],
  [ChainId.ETHEREUM_MAINNET, 'ETHEREUM'],
  [ChainId.OPTIMISM_MAINNET, 'OPTIMISM'],
]);

/**
 * Read-only RPC provider manager for scanner-service (S1-4-RPC).
 *
 * One ethers v6 provider per chain, plus a per-chain token bucket that bounds the outbound
 * call rate so the scanner does not trip 429 on free public RPC (~50 req/min — see
 * docs/adr-scanner-service.md §4). The bucket is consulted via {@link tryAcquire} before
 * every read; a denied call increments `arb_scanner_rpc_rate_limited_total` and the caller
 * skips that read this cycle.
 *
 * Env namespace is isolated from execution-orchestrator: `RPC_SCANNER_<CHAIN>_URL` first,
 * falling back to the shared `RPC_<CHAIN>_MAINNET_URL`. This keeps the scanner's rate budget
 * decoupled from execution's health-check / pool-read traffic. No wallet / signing path —
 * strictly read-only.
 *
 * Pattern mirrors apps/execution-orchestrator/src/execution/rpc/rpc-provider-manager.service.ts
 * (provider creation + health probe), but uses the `ChainId` enum and adds the token bucket.
 */
@Injectable()
export class ScannerRpcService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScannerRpcService.name);

  /** Chains the scanner scans by default (Arb/Base/BNB/Ethereum/Optimism mainnet). Driven by config poolWhitelist. */
  private readonly SUPPORTED_CHAINS = [
    ChainId.ARBITRUM_ONE_MAINNET,
    ChainId.BASE_MAINNET,
    ChainId.BNB_CHAIN_MAINNET,
    ChainId.ETHEREUM_MAINNET,
    ChainId.OPTIMISM_MAINNET,
  ];

  private readonly providers = new Map<
    number,
    {
      primary: JsonRpcProvider;
      backup?: JsonRpcProvider;
      combined?: FallbackProvider;
    }
  >();
  private readonly healthStatus = new Map<
    number,
    { healthy: boolean; latency: number; error?: string; blockNumber: number | null }
  >();
  private readonly buckets = new Map<number, TokenBucket>();
  private healthCheckTimer?: ReturnType<typeof setInterval>;

  private readonly LATENCY_THRESHOLD_MS = 2000; // free public RPC is slow; 2s SLO
  private readonly HEALTH_CHECK_INTERVAL_MS = 30_000;

  private readonly metrics = (() => {
    const reg = getArbibotMetricsRegistry();
    const safe = <T>(make: () => T): T | undefined => {
      try {
        return make();
      } catch {
        // Already registered (shared registry in tests) — reuse existing.
        return undefined;
      }
    };
    return {
      latency: safe(
        () =>
          new Histogram({
            name: 'arb_scanner_rpc_latency_ms',
            help: 'Scanner RPC call latency in milliseconds',
            labelNames: ['chain_id', 'method'],
            buckets: [50, 100, 250, 500, 1000, 2000, 5000, 10000],
            registers: [reg],
          }),
      ),
      rateLimited: safe(
        () =>
          new Counter({
            name: 'arb_scanner_rpc_rate_limited_total',
            help: 'Scanner RPC calls denied by the token-bucket rate limiter',
            labelNames: ['chain_id'],
            registers: [reg],
          }),
      ),
      failures: safe(
        () =>
          new Counter({
            name: 'arb_scanner_rpc_failures_total',
            help: 'Scanner RPC call failures',
            labelNames: ['chain_id'],
            registers: [reg],
          }),
      ),
      tokensAvailable: safe(
        () =>
          new Gauge({
            name: 'arb_scanner_rpc_tokens_available',
            help: 'Scanner RPC token-bucket available tokens (rate budget headroom)',
            labelNames: ['chain_id'],
            registers: [reg],
          }),
      ),
    };
  })();

  constructor() {}

  onModuleInit(): void {
    this.initializeProviders();
    this.startHealthChecks();
  }

  onModuleDestroy(): void {
    if (this.healthCheckTimer !== undefined) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
    // ethers v6 JsonRpcProvider.destroy() is synchronous (returns void).
    for (const p of this.providers.values()) {
      try {
        p.primary.destroy();
        p.backup?.destroy();
      } catch {
        /* best-effort cleanup */
      }
    }
    this.providers.clear();
    this.healthStatus.clear();
    this.buckets.clear();
  }

  /**
   * Get the read-only provider for a chain. Throws if no provider is configured.
   * Callers MUST first check {@link tryAcquire} to respect the rate budget.
   */
  getProvider(chainId: number): Provider {
    const config = this.providers.get(chainId);
    if (config === undefined) {
      throw new Error(`No scanner RPC provider configured for chain ${chainId}`);
    }
    return config.combined ?? config.primary;
  }

  /**
   * Try to acquire one rate-budget token for a chain. Returns true if the call may proceed,
   * false if the token bucket is empty (caller should skip the read this cycle and the
   * `arb_scanner_rpc_rate_limited_total` counter is incremented).
   */
  tryAcquire(chainId: number): boolean {
    const bucket = this.buckets.get(chainId);
    if (bucket === undefined) {
      // No bucket → no provider configured; treat as denied.
      return false;
    }
    const allowed = bucket.tryConsume(1);
    if (!allowed) {
      this.metrics.rateLimited?.inc({ chain_id: String(chainId) });
    }
    return allowed;
  }

  /** Health snapshot for a single chain (for GET /health/rpc). */
  getHealthStatus(chainId: number): {
    healthy: boolean;
    latency: number;
    error?: string;
    blockNumber: number | null;
    tokensAvailable: number;
  } | null {
    const status = this.healthStatus.get(chainId);
    const bucket = this.buckets.get(chainId);
    if (status === undefined) {
      return null;
    }
    return {
      ...status,
      tokensAvailable: bucket?.availableTokens() ?? 0,
    };
  }

  /** Health snapshot for all configured chains. */
  getAllHealthStatus(): Record<
    string,
    {
      healthy: boolean;
      latency: number;
      error?: string;
      blockNumber: number | null;
      tokensAvailable: number;
      configured: boolean;
    }
  > {
    const out: Record<string, ReturnType<ScannerRpcService['getHealthStatus']>> & {
      [k: string]: ReturnType<ScannerRpcService['getHealthStatus']> & {
        configured: boolean;
      };
    } = {};
    for (const chainId of this.SUPPORTED_CHAINS) {
      const status = this.getHealthStatus(chainId);
      out[String(chainId)] = {
        ...(status ?? {
          healthy: false,
          latency: 0,
          blockNumber: null,
          tokensAvailable: 0,
          error: 'not configured',
        }),
        configured: status !== null,
      };
    }
    return out;
  }

  // --- internal ------------------------------------------------------------

  /**
   * Resolve the scanner-isolated RPC URL for a chain: `RPC_SCANNER_<CHAIN>_URL` first, then
   * the shared `RPC_<CHAIN>_MAINNET_URL`. Returns undefined if neither is set.
   */
  private resolveUrl(chainId: number, role: 'primary' | 'backup'): string | undefined {
    const networkName = this.chainNetworkName(chainId);
    const scannerVar = `RPC_SCANNER_${networkName}${role === 'backup' ? '_BACKUP' : ''}_URL`;
    const sharedVar = `RPC_${networkName}_MAINNET${role === 'backup' ? '_BACKUP' : ''}_URL`;
    return (
      process.env[scannerVar]?.trim() || process.env[sharedVar]?.trim() || undefined
    );
  }

  private chainNetworkName(chainId: number): string {
    const name = CHAIN_ID_TO_RPC_NETWORK.get(chainId);
    return name ?? String(chainId);
  }

  private initializeProviders(): void {
    const ratePerSecond = this.resolveRatePerSecond();
    for (const chainId of this.SUPPORTED_CHAINS) {
      const primary = this.resolveUrl(chainId, 'primary');
      const backup = this.resolveUrl(chainId, 'backup');
      if (primary === undefined) {
        this.logger.warn(
          `No scanner RPC URL for chain ${chainId} (env RPC_SCANNER_${this.chainNetworkName(
            chainId,
          )}_URL or RPC_${this.chainNetworkName(chainId)}_MAINNET_URL); chain disabled`,
        );
        continue;
      }
      try {
        // staticNetwork: true + pinned FallbackProvider — same fix as execution-orchestrator
        // (PLAN11 #46 + §10). Without it, FallbackProvider._detectNetwork dispatches a live
        // eth_chainId per child and throws NETWORK_ERROR on load-balancer drift, which silently
        // nulls every pool read (0 pools, 0 spreads). See pinFallbackNetwork above.
        const primaryProvider = new JsonRpcProvider(primary, chainId, { staticNetwork: true });
        let backupProvider: JsonRpcProvider | undefined;
        let combined: FallbackProvider | undefined;
        if (backup !== undefined) {
          backupProvider = new JsonRpcProvider(backup, chainId, { staticNetwork: true });
          combined = pinFallbackNetwork(
            new FallbackProvider([primaryProvider, backupProvider], chainId, { quorum: 1 }),
            chainId,
          );
        }
        this.providers.set(chainId, {
          primary: primaryProvider,
          backup: backupProvider,
          combined,
        });
        this.healthStatus.set(chainId, {
          healthy: true,
          latency: 0,
          blockNumber: null,
        });
        this.buckets.set(chainId, new TokenBucket(ratePerSecond));
        this.logger.log(
          `Scanner RPC provider initialized for chain ${chainId} (primary${
            backup ? ' + backup' : ''
          }, rate ${ratePerSecond} rps)`,
        );
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to initialize scanner RPC provider for chain ${chainId}: ${error}`,
        );
        this.healthStatus.set(chainId, {
          healthy: false,
          latency: Infinity,
          error,
          blockNumber: null,
        });
      }
    }
  }

  private resolveRatePerSecond(): number {
    const raw =
      process.env.SCANNER_RPC_RATE_LIMIT_RPS ?? String(DEFAULT_SCANNER_RPC_RATE_LIMIT_RPS);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_SCANNER_RPC_RATE_LIMIT_RPS;
  }

  private startHealthChecks(): void {
    this.healthCheckTimer = setInterval(() => {
      void this.runHealthChecks();
    }, this.HEALTH_CHECK_INTERVAL_MS);
    this.healthCheckTimer.unref?.();
    // Initial probe so /health/rpc has data immediately on boot.
    void this.runHealthChecks();
  }

  private async runHealthChecks(): Promise<void> {
    for (const [chainId, config] of this.providers.entries()) {
      await this.checkProviderHealth(chainId, config.primary);
      // Publish current token availability as a gauge for budget visibility.
      const bucket = this.buckets.get(chainId);
      if (bucket !== undefined) {
        this.metrics.tokensAvailable?.set(
          { chain_id: String(chainId) },
          bucket.availableTokens(),
        );
      }
    }
  }

  private async checkProviderHealth(
    chainId: number,
    provider: JsonRpcProvider,
  ): Promise<void> {
    const start = Date.now();
    try {
      const blockNumber = await provider.getBlockNumber();
      const latency = Date.now() - start;
      const healthy = latency < this.LATENCY_THRESHOLD_MS;
      this.healthStatus.set(chainId, { healthy, latency, blockNumber });
      this.metrics.latency?.observe(
        { chain_id: String(chainId), method: 'getBlockNumber' },
        latency,
      );
      if (!healthy) {
        this.logger.warn(
          `Scanner RPC chain ${chainId} latency ${latency}ms exceeds ${this.LATENCY_THRESHOLD_MS}ms SLO`,
        );
      }
    } catch (err) {
      const latency = Date.now() - start;
      const error = err instanceof Error ? err.message : String(err);
      this.healthStatus.set(chainId, { healthy: false, latency, error, blockNumber: null });
      this.metrics.failures?.inc({ chain_id: String(chainId) });
      this.logger.error(`Scanner RPC chain ${chainId} health check failed: ${error}`);
    }
  }
}
