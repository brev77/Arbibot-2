import { Injectable, Logger } from '@nestjs/common';
import { Provider } from 'ethers';
import { Address } from '@arbibot/contracts-eth';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Counter, Gauge } from 'prom-client';

/**
 * Nonce Manager Service (P9-3)
 *
 * Per-wallet async mutex + monotonic nonce tracker. Eliminates the nonce race
 * that occurs when multiple concurrent legs (multi-leg plan) select the same
 * wallet and each independently reads the pending nonce from the RPC.
 *
 * Without this lock, two concurrent `sendTransaction` calls on the same wallet
 * race for the same nonce → one tx fails with "nonce too low", or worse, one
 * silently replaces the other in the mempool, stalling ALL subsequent txs of
 * that wallet (stuck nonce).
 *
 * Design:
 * - A `Map<address, Promise>` chain serializes all tx submissions per wallet.
 *   Within a single serialized slot, the manager:
 *     1. reads `provider.getTransactionCount(address, 'pending')` (authoritative
 *        RPC nonce, includes mempool-pending txs),
 *     2. passes that explicit `nonce` to the caller's `sendTransaction`.
 * - The DB-tracked nonce (`wallet_states.nonce`) is updated synchronously
 *   inside the lock so the wallet-manager's view stays consistent. On process
 *   start the RPC is authoritative (the DB nonce is best-effort only).
 *
 * Boundary: single-writer is preserved — this service only reads/writes
 * `wallet_states` (owned by execution-orchestrator). It does NOT touch
 * capital_reservations or any other service's table.
 */
@Injectable()
export class NonceManagerService {
  private readonly logger = new Logger(NonceManagerService.name);

  /** Per-wallet serialized queue. Each entry is the tail promise; new txs chain onto it. */
  private readonly queues = new Map<string, Promise<unknown>>();

  private readonly txSubmittedCounter: Counter;
  private readonly nonceDriftGauge: Gauge;

  constructor() {
    const registry = getArbibotMetricsRegistry();

    const submittedName = 'arb_wallet_tx_submitted_total';
    const existingSubmitted = registry.getSingleMetric(submittedName);
    this.txSubmittedCounter =
      existingSubmitted instanceof Counter
        ? existingSubmitted
        : new Counter({
            name: submittedName,
            help: 'Transactions submitted through the nonce manager (per wallet address)',
            labelNames: ['chain_id'],
            registers: [registry],
          });

    const driftName = 'arb_wallet_nonce_drift';
    const existingDrift = registry.getSingleMetric(driftName);
    this.nonceDriftGauge =
      existingDrift instanceof Gauge
        ? existingDrift
        : new Gauge({
            name: driftName,
            help: 'Difference between RPC pending nonce and the last locally-tracked nonce (P9-3, >0 indicates drift)',
            labelNames: ['chain_id', 'address'],
            registers: [registry],
          });
  }

  /**
   * Acquire the next nonce for a wallet, serialized per-address. The caller
   * MUST pass the returned `nonce` explicitly to `sendTransaction` and resolve
   * the returned `release` only after the broadcast outcome is known
   * (success/throw). The lock is held for the duration of `fn`, so `fn` should
   * do only the broadcast (sendTransaction) — NOT a long `tx.wait` (see
   * {@link withBroadcastLock}).
   *
   * @param chainId  numeric chain id (for metrics)
   * @param address  the signing wallet address (lock key)
   * @param provider RPC provider to read the authoritative pending nonce
   * @returns the explicit nonce to pass to sendTransaction
   */
  async acquireNextNonce(chainId: number, address: Address, provider: Provider): Promise<number> {
    return this.serialize(address, async () => {
      const rpcNonce = await provider.getTransactionCount(address, 'pending');
      return rpcNonce;
    }).then((nonce) => {
      this.txSubmittedCounter.inc({ chain_id: String(chainId) });
      return nonce;
    });
  }

  /**
   * Run a broadcast function under the per-wallet lock and hand it the explicit
   * nonce. Use this to wrap `wallet.sendTransaction({ ..., nonce })`. The lock
   * is released as soon as `fn` resolves (broadcast returned a tx) or rejects,
   * so do NOT await `tx.wait` inside `fn` — that would serialize confirmations
   * and tank throughput. Await the receipt after the lock releases.
   *
   * Example:
   * ```ts
   * const { tx } = await nonceManager.withBroadcastLock(
   *   chainId, selectedWallet.address, selectedWallet.wallet.provider!,
   *   (nonce) => selectedWallet.wallet.sendTransaction({ ...txRequest, nonce }),
   * );
   * const receipt = await tx.wait(1); // outside the lock
   * ```
   */
  async withBroadcastLock<T>(
    chainId: number,
    address: Address,
    provider: Provider,
    fn: (nonce: number) => Promise<T>,
  ): Promise<T> {
    return this.serialize(address, async () => {
      const nonce = await provider.getTransactionCount(address, 'pending');
      // On failure the nonce may or may not have been consumed depending on
      // where the error occurred (pre-broadcast vs RPC rejection). The next
      // acquire re-reads the RPC pending count, so we do NOT increment locally
      // on failure — the RPC is the source of truth.
      const result = await fn(nonce);
      this.txSubmittedCounter.inc({ chain_id: String(chainId) });
      return result;
    });
  }

  /**
   * Serialize an async task per wallet address. Each subsequent call chains onto
   * the previous tail so that at most one task per address runs at a time.
   * Failures in one task do not break the chain (the next caller still acquires).
   */
  private serialize<T>(address: string, task: () => Promise<T>): Promise<T> {
    const tail = this.queues.get(address) ?? Promise.resolve();
    const next = tail.then(task, task) as Promise<unknown>;
    // Swallow rejection on the stored tail so a failed task doesn't poison the
    // chain for subsequent callers (the error still propagates to the caller of
    // THIS invocation via `next`'s own returned promise).
    const stored = next.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(address, stored);
    return next as Promise<T>;
  }

  /**
   * Record a nonce drift observation (RPC pending nonce vs locally tracked).
   * Called by WalletManagerService when it syncs `wallet_states.nonce`. A
   * persistently high drift indicates stuck/replaced mempool txs.
   */
  recordNonceDrift(chainId: number, address: string, rpcNonce: number, localNonce: number): void {
    const drift = Math.max(0, rpcNonce - localNonce);
    this.nonceDriftGauge.set({ chain_id: String(chainId), address }, drift);
    if (drift > 1) {
      this.logger.warn(
        `Nonce drift on ${address} (chain ${chainId}): rpc=${rpcNonce} local=${localNonce} drift=${drift} — possible stuck/replaced mempool tx`,
      );
    }
  }
}
