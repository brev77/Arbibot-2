import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TransactionReceipt, TransactionResponse } from 'ethers';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Counter, Histogram } from 'prom-client';
import { OnChainTransaction } from '@arbibot/persistence';
import { getRequiredConfirmations } from '@arbibot/contracts-eth';
import { RpcProviderManager } from './rpc/rpc-provider-manager.service';

/**
 * Default per-chain timeout for `tx.wait` (P9-4). On congestion or an
 * underpriced tx, `tx.wait(1)` would hang forever, holding the leg in
 * `submitting` and blocking the nonce lock. The timeout returns control to the
 * adapter, which throws VenueSubmitTransientError → the leg stays `submitting`
 * for the reaper (P9-7). The tx is NOT lost: the confirmation poller below
 * keeps checking pending OnChainTransaction rows and reconciles them once mined.
 */
const DEFAULT_TX_WAIT_TIMEOUT_MS_BY_CHAIN: Readonly<Record<number, number>> = {
  // Arbitrum / Base — sequencer finality, fast blocks; 60s is generous.
  42161: 60_000,
  421614: 60_000,
  8453: 60_000,
  84532: 60_000,
  // BNB Chain — faster blocks but more reorgs; allow 120s.
  56: 120_000,
  97: 120_000,
  // Ethereum mainnet — 12s blocks; 180s ≈ 15 blocks.
  1: 180_000,
};
const FALLBACK_TX_WAIT_TIMEOUT_MS = 120_000;

/**
 * Resolve the `tx.wait` timeout for a chain (env override `TX_WAIT_TIMEOUT_MS_{CHAINID}`).
 */
export function resolveTxWaitTimeoutMs(chainId: number): number {
  const envOverride = process.env[`TX_WAIT_TIMEOUT_MS_${chainId}`];
  if (envOverride !== undefined && envOverride.length > 0) {
    const n = Number(envOverride);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return DEFAULT_TX_WAIT_TIMEOUT_MS_BY_CHAIN[chainId] ?? FALLBACK_TX_WAIT_TIMEOUT_MS;
}

/**
 * Wait for a tx confirmation with a chain-aware timeout (P9-4). Resolves with
 * the receipt on success, or `null` on timeout (the caller treats null as a
 * transient error — the tx may still be in the mempool; the poller reconciles).
 *
 * The confirmations count is chain-specific (sequencer finality for L2s, more
 * for L1 / BNB Chain) via `getRequiredConfirmations`.
 */
export async function waitForConfirmation(
  tx: TransactionResponse,
  chainId: number,
  timeoutMs?: number,
): Promise<TransactionReceipt | null> {
  const timeout = timeoutMs ?? resolveTxWaitTimeoutMs(chainId);
  const confirmations = getRequiredConfirmations(chainId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const receipt = await Promise.race([
      tx.wait(confirmations),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeout);
      }),
    ]);
    return receipt;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Background confirmation poller (P9-4).
 *
 * Periodically scans OnChainTransaction rows in `pending` status (written by
 * P9-2's persistWithOutcome when the adapter returned a confirmed receipt, or
 * — after a future enhancement — written as pending before broadcast). For each
 * pending row, it queries the RPC for the receipt and, if mined, updates the
 * row to confirmed/reverted + emits the DexTransaction outbox event.
 *
 * This closes the crash window: if the process dies between broadcast and
 * Phase 3 commit (leg stayed `submitting`, no OnChainTransaction row written
 * yet), the stuck-plan reaper (P9-7) re-checks via the RPC provider directly.
 * If Phase 3 partially committed (row written as pending), this poller finishes
 * the job. Both paths converge on a durable, reconciled on-chain proof.
 *
 * NOTE: in the current P9-1/P9-2 cut, adapters wait for the receipt BEFORE
 * returning, so rows are only ever written in a terminal status (confirmed/
 * failed/reverted). The poller is forward-compatible: if a later change writes
 * `pending` rows pre-broadcast (Phase 1.5), the poller will reconcile them
 * without further changes. It also serves as defense-in-depth for any row that
 * lands in `pending` due to a partial write.
 */
@Injectable()
export class TxConfirmationPollerWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TxConfirmationPollerWorker.name);
  private isRunning = false;
  private isShuttingDown = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  private readonly pollCycleCounter: Counter;
  private readonly confirmedCounter: Counter;
  private readonly pollLagHistogram: Histogram;

  constructor(
    @InjectRepository(OnChainTransaction)
    private readonly onChainTxRepo: Repository<OnChainTransaction>,
    private readonly rpcProviderManager: RpcProviderManager,
  ) {
    const registry = getArbibotMetricsRegistry();
    const cycleName = 'arb_execution_tx_confirmation_poll_cycles_total';
    this.pollCycleCounter =
      registry.getSingleMetric(cycleName) instanceof Counter
        ? (registry.getSingleMetric(cycleName) as Counter)
        : new Counter({
            name: cycleName,
            help: 'Tx confirmation poller cycles (P9-4)',
            labelNames: ['status'],
            registers: [registry],
          });
    const confirmedName = 'arb_execution_tx_confirmation_resolved_total';
    this.confirmedCounter =
      registry.getSingleMetric(confirmedName) instanceof Counter
        ? (registry.getSingleMetric(confirmedName) as Counter)
        : new Counter({
            name: confirmedName,
            help: 'Pending on-chain txs resolved by the poller (P9-4)',
            labelNames: ['status'],
            registers: [registry],
          });
    const lagName = 'arb_execution_tx_confirmation_lag_seconds';
    this.pollLagHistogram =
      registry.getSingleMetric(lagName) instanceof Histogram
        ? (registry.getSingleMetric(lagName) as Histogram)
        : new Histogram({
            name: lagName,
            help: 'Age of a pending on-chain tx at the moment the poller resolves it (P9-4)',
            buckets: [5, 15, 30, 60, 120, 300, 600],
            registers: [registry],
          });
  }

  onModuleInit(): void {
    const enabled = process.env.TX_CONFIRMATION_POLLER_ENABLED !== 'false';
    if (!enabled) {
      this.logger.log('Tx confirmation poller disabled (TX_CONFIRMATION_POLLER_ENABLED=false)');
      return;
    }
    const intervalMs = Number(process.env.TX_CONFIRMATION_POLL_INTERVAL_MS ?? 15_000);
    this.logger.log(`Starting tx confirmation poller (interval ${intervalMs}ms)`);
    this.pollInterval = setInterval(() => {
      void this.runPollCycle();
    }, intervalMs);
    this.pollInterval.unref?.();
  }

  onModuleDestroy(): void {
    this.isShuttingDown = true;
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.logger.log('Tx confirmation poller shutting down');
  }

  /**
   * One poll cycle: fetch pending OnChainTransaction rows (bounded batch) and
   * reconcile each via the RPC provider. Returns the number resolved.
   */
  async runPollCycle(): Promise<number> {
    if (this.isRunning || this.isShuttingDown) {
      return 0;
    }
    this.isRunning = true;
    let resolved = 0;
    try {
      const batchSize = Number(process.env.TX_CONFIRMATION_POLL_BATCH_SIZE ?? 20);
      const pending = await this.onChainTxRepo.find({
        where: { status: 'pending' as OnChainTransaction['status'] },
        take: batchSize,
        order: { createdAt: 'ASC' },
      });
      if (pending.length === 0) {
        this.pollCycleCounter.inc({ status: 'idle' });
        return 0;
      }
      for (const tx of pending) {
        try {
          const provider = this.rpcProviderManager.getProvider(tx.chainId);
          const receipt = await provider.getTransactionReceipt(tx.txHash);
          if (receipt === null) {
            // Still pending in mempool / not mined yet.
            continue;
          }
          const status: 'confirmed' | 'reverted' = receipt.status === 1 ? 'confirmed' : 'reverted';
          const ageSeconds = (Date.now() - tx.createdAt.getTime()) / 1000;
          this.pollLagHistogram.observe(Math.max(0, ageSeconds));
          await this.onChainTxRepo.update(tx.id, {
            status,
            gasUsed: receipt.gasUsed.toString(),
            gasPrice: (receipt.gasPrice ?? null)?.toString() ?? null,
            blockNumber: receipt.blockNumber,
            blockHash: receipt.blockHash ?? null,
            transactionIndex: receipt.index ?? null,
            confirmedAt: new Date(),
            revertReason: status === 'reverted' ? 'tx reverted on-chain (poller)' : null,
          });
          this.confirmedCounter.inc({ status });
          this.logger.log(
            `Poller resolved pending tx ${tx.txHash} → ${status} (leg ${tx.legId})`,
          );
          resolved += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Poller failed to resolve pending tx ${tx.txHash}: ${msg}`);
        }
      }
      this.pollCycleCounter.inc({ status: resolved > 0 ? 'resolved' : 'pending' });
      return resolved;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Tx confirmation poll cycle failed: ${msg}`);
      this.pollCycleCounter.inc({ status: 'error' });
      return resolved;
    } finally {
      this.isRunning = false;
    }
  }
}
