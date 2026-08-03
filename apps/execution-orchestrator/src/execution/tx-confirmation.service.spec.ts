import type { TransactionReceipt, TransactionResponse } from 'ethers';
import type { OnChainTransaction } from '@arbibot/persistence';
import type { Repository } from 'typeorm';

import { resolveTxWaitTimeoutMs, waitForConfirmation, TxConfirmationPollerWorker } from './tx-confirmation.service';
import type { RpcProviderManager } from './rpc/rpc-provider-manager.service';

describe('tx-confirmation.service (P9-4)', () => {
  describe('resolveTxWaitTimeoutMs', () => {
    const original = { ...process.env };
    afterEach(() => {
      process.env = { ...original };
    });

    it('returns chain-specific defaults (Arbitrum 60s, BNB 120s, L1 180s)', () => {
      expect(resolveTxWaitTimeoutMs(42161)).toBe(60_000);
      expect(resolveTxWaitTimeoutMs(56)).toBe(120_000);
      expect(resolveTxWaitTimeoutMs(1)).toBe(180_000);
    });

    it('falls back to 120s for unknown chains', () => {
      expect(resolveTxWaitTimeoutMs(99999)).toBe(120_000);
    });

    it('honours TX_WAIT_TIMEOUT_MS_{CHAINID} env override', () => {
      process.env.TX_WAIT_TIMEOUT_MS_42161 = '45000';
      expect(resolveTxWaitTimeoutMs(42161)).toBe(45_000);
    });
  });

  describe('waitForConfirmation', () => {
    it('resolves with the receipt when tx.wait resolves in time', async () => {
      const receipt = { status: 1, gasUsed: 21000n } as unknown as TransactionReceipt;
      const tx = { wait: jest.fn().mockResolvedValue(receipt) } as unknown as TransactionResponse;
      const result = await waitForConfirmation(tx, 42161, 1000);
      expect(result).toBe(receipt);
    });

    it('resolves with null on timeout (tx stays in mempool, poller reconciles)', async () => {
      const tx = {
        wait: jest.fn(
          () => new Promise((resolve) => setTimeout(() => resolve({ status: 1 }), 500)),
        ),
      } as unknown as TransactionResponse;
      const result = await waitForConfirmation(tx, 42161, 50);
      expect(result).toBeNull();
    });
  });

  describe('TxConfirmationPollerWorker', () => {
    function buildWorker(opts: {
      pendingRows?: Partial<OnChainTransaction>[];
      receiptFor?: (txHash: string) => TransactionReceipt | null;
    }) {
      const rows = opts.pendingRows ?? [];
      const repo = {
        find: jest.fn(() => Promise.resolve(rows)),
        update: jest.fn(() => Promise.resolve({ affected: 1 })),
      } as unknown as Repository<OnChainTransaction>;
      const provider = {
        getTransactionReceipt: jest.fn((txHash: string) =>
          Promise.resolve(opts.receiptFor ? opts.receiptFor(txHash) : null),
        ),
      };
      const rpcProviderManager = { getProvider: jest.fn(() => provider) } as unknown as RpcProviderManager;
      const worker = new TxConfirmationPollerWorker(repo, rpcProviderManager);
      return { worker, repo, provider };
    }

    it('returns 0 when there are no pending rows', async () => {
      const { worker } = buildWorker({ pendingRows: [] });
      expect(await worker.runPollCycle()).toBe(0);
    });

    it('resolves a confirmed pending tx and updates the row', async () => {
      const { worker, repo } = buildWorker({
        pendingRows: [
          { id: 1, txHash: '0xtx1', chainId: 42161, legId: 'leg-1', status: 'pending', createdAt: new Date() },
        ],
        receiptFor: () => ({ status: 1, gasUsed: 21000n, blockNumber: 100 }) as unknown as TransactionReceipt,
      });
      const resolved = await worker.runPollCycle();
      expect(resolved).toBe(1);
      expect(repo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ status: 'confirmed', blockNumber: 100 }),
      );
    });

    it('marks a reverted tx (status=0) as reverted', async () => {
      const { worker, repo } = buildWorker({
        pendingRows: [
          { id: 2, txHash: '0xtx2', chainId: 42161, legId: 'leg-2', status: 'pending', createdAt: new Date() },
        ],
        receiptFor: () => ({ status: 0, gasUsed: 21000n, blockNumber: 101 }) as unknown as TransactionReceipt,
      });
      await worker.runPollCycle();
      expect(repo.update).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ status: 'reverted' }),
      );
    });

    it('skips rows whose tx is still null (not mined yet)', async () => {
      const { worker, repo } = buildWorker({
        pendingRows: [
          { id: 3, txHash: '0xtx3', chainId: 42161, legId: 'leg-3', status: 'pending', createdAt: new Date() },
        ],
        receiptFor: () => null,
      });
      const resolved = await worker.runPollCycle();
      expect(resolved).toBe(0);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('does not crash when getTransactionReceipt throws (logs + continues)', async () => {
      const { worker } = buildWorker({
        pendingRows: [
          { id: 4, txHash: '0xtx4', chainId: 42161, legId: 'leg-4', status: 'pending', createdAt: new Date() },
        ],
        receiptFor: () => {
          throw new Error('RPC error');
        },
      });
      const resolved = await worker.runPollCycle();
      expect(resolved).toBe(0);
    });
  });
});
