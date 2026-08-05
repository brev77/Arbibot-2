import { Injectable, Logger } from '@nestjs/common';
import { Provider } from 'ethers';
import { Address } from '@arbibot/contracts-eth';
import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';
import { Counter, Gauge } from 'prom-client';

/**
 * Timeout for the RPC `getTransactionCount` read inside {@link withBroadcastLock}.
 *
 * P9-3 follow-up: the broadcast path was hanging because an unresponsive RPC
 * made `provider.getTransactionCount(address, 'pending')` never resolve. Since
 * {@link serialize} chains every call per address, one hung read poisoned the
 * whole per-wallet queue (and every leg on that wallet stayed `submitting`).
 * This bound (env-overridable) makes the nonce read fail-closed instead of
 * hanging forever; the per-wallet queue is NOT poisoned on timeout (see
 * {@link serialize}).
 */
const BROADCAST_RPC_TIMEOUT_MS = process.env.BROADCAST_RPC_TIMEOUT_MS
  ? Number.parseInt(process.env.BROADCAST_RPC_TIMEOUT_MS, 10)
  : 30_000;

/**
 * Timeout for the broadcast `fn(nonce)` itself (the actual `sendTransaction`).
 *
 * Broadcast is allowed to take longer than a plain RPC read (mempool acceptance,
 * fee negotiation), but it MUST NOT be infinite. Defaults to 2× the RPC read
 * timeout. On timeout the lock releases (the queue is not poisoned) and the
 * caller sees `Error('broadcast fn timeout')`.
 */
const BROADCAST_FN_TIMEOUT_MS = process.env.BROADCAST_FN_TIMEOUT_MS
  ? Number.parseInt(process.env.BROADCAST_FN_TIMEOUT_MS, 10)
  : BROADCAST_RPC_TIMEOUT_MS * 2;

/**
 * Reject after `ms` with `Error(message)`. Used to bound RPC/broadcast calls
 * that have no native timeout. The returned timer is exposed via `clear` so the
 * caller can cancel it when the wrapped promise settles first (otherwise the
 * Node event loop keeps the timer alive for the full duration on every call).
 */
function raceTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): { promise: Promise<T>; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return {
    promise: Promise.race([promise, timeout]),
    clear: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    },
  };
}

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
      const acquireStart = Date.now();
      this.logger.log(
        `withBroadcastLock: acquiring nonce for ${address} (chain ${chainId}) at ${new Date().toISOString()}`,
      );

      // Bound the RPC nonce read. A hung `getTransactionCount` previously
      // poisoned the per-wallet queue (serialize chains all calls); on timeout
      // we throw, serialize releases the slot for the next caller, and the leg
      // stays `submitting` for the reaper.
      const nonceRace = raceTimeout(
        provider.getTransactionCount(address, 'pending'),
        BROADCAST_RPC_TIMEOUT_MS,
        'RPC timeout reading nonce',
      );
      let nonce: number;
      try {
        nonce = await nonceRace.promise;
      } finally {
        nonceRace.clear();
      }

      this.logger.log(
        `withBroadcastLock: nonce acquired: ${nonce} for ${address} took=${Date.now() - acquireStart}ms`,
      );

      // Bound the broadcast fn itself. `sendTransaction` is usually fast, but
      // fee negotiation / mempool back-pressure can stall it; we refuse to hold
      // the per-wallet lock indefinitely. On timeout the queue is released
      // (serialize does not poison on rejection) and the caller sees the error.
      const fnRace = raceTimeout(
        fn(nonce),
        BROADCAST_FN_TIMEOUT_MS,
        'broadcast fn timeout',
      );
      let result: T;
      try {
        result = await fnRace.promise;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `withBroadcastLock: broadcast failed for ${address} nonce=${nonce} took=${Date.now() - acquireStart}ms: ${msg}`,
        );
        throw err;
      } finally {
        fnRace.clear();
      }

      // On failure the nonce may or may not have been consumed depending on
      // where the error occurred (pre-broadcast vs RPC rejection). The next
      // acquire re-reads the RPC pending count, so we do NOT increment locally
      // on failure — the RPC is the source of truth.
      this.txSubmittedCounter.inc({ chain_id: String(chainId) });
      this.logger.log(
        `withBroadcastLock: broadcast fn done for ${address} nonce=${nonce} took=${Date.now() - acquireStart}ms`,
      );
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
