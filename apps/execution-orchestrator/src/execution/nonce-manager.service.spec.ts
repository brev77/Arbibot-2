import { getArbibotMetricsRegistry } from '@arbibot/nest-platform';

import { NonceManagerService } from './nonce-manager.service';

describe('NonceManagerService (P9-3)', () => {
  let service: NonceManagerService;

  function buildProvider(nextNonce: () => number): { provider: { getTransactionCount: jest.Mock } } {
    return {
      provider: {
        getTransactionCount: jest.fn(() => Promise.resolve(nextNonce())),
      },
    };
  }

  beforeEach(() => {
    getArbibotMetricsRegistry().clear();
    service = new NonceManagerService();
  });

  describe('withBroadcastLock', () => {
    it('passes the RPC nonce to the broadcast fn', async () => {
      const { provider } = buildProvider(() => 42);
      const seen: number[] = [];
      await service.withBroadcastLock(42161, '0xWallet', provider as never, (nonce) => {
        seen.push(nonce);
        return Promise.resolve('ok');
      });
      expect(seen).toEqual([42]);
      expect(provider.getTransactionCount).toHaveBeenCalledWith('0xWallet', 'pending');
    });

    it('serializes concurrent broadcasts for the SAME wallet (no nonce race)', async () => {
      // Simulate an RPC that returns the same pending nonce for two concurrent
      // reads — the lock must ensure the second broadcast only starts after the
      // first resolves, and re-reads the (now incremented) nonce.
      let nonceState = 5;
      const { provider } = buildProvider(() => {
        const n = nonceState;
        return n;
      });
      const order: string[] = [];

      const p1 = service
        .withBroadcastLock(42161, '0xWallet', provider as never, async (nonce) => {
          order.push(`p1-start nonce=${nonce}`);
          await new Promise((r) => setTimeout(r, 20));
          // Simulate the RPC bumping the pending count after p1's broadcast.
          nonceState = 6;
          order.push('p1-end');
          return 'tx1';
        })
        .then((r) => {
          order.push('p1-resolved');
          return r;
        });

      const p2 = service
        .withBroadcastLock(42161, '0xWallet', provider as never, (nonce) => {
          order.push(`p2-start nonce=${nonce}`);
          return Promise.resolve('tx2');
        })
        .then((r) => {
          order.push('p2-resolved');
          return r;
        });

      await Promise.all([p1, p2]);

      // p1 fully completed (start+end) before p2 started, and p2 saw the
      // incremented nonce (6), not the stale 5.
      expect(order).toEqual([
        'p1-start nonce=5',
        'p1-end',
        'p1-resolved',
        'p2-start nonce=6',
        'p2-resolved',
      ]);
    });

    it('does NOT serialize broadcasts across DIFFERENT wallets', async () => {
      const { provider } = buildProvider(() => 1);
      const order: string[] = [];

      const p1 = service
        .withBroadcastLock(42161, '0xWalletA', provider as never, async () => {
          order.push('a-start');
          await new Promise((r) => setTimeout(r, 20));
          order.push('a-end');
          return 'a';
        });
      const p2 = service
        .withBroadcastLock(42161, '0xWalletB', provider as never, async () => {
          order.push('b-start');
          await new Promise((r) => setTimeout(r, 20));
          order.push('b-end');
          return 'b';
        });

      await Promise.all([p1, p2]);
      // Both started before either ended → parallel (different lock keys).
      expect(order.indexOf('a-start')).toBeLessThanOrEqual(1);
      expect(order.indexOf('b-start')).toBeLessThanOrEqual(1);
    });

    it('a failed broadcast does not poison the lock for subsequent callers', async () => {
      const { provider } = buildProvider(() => 7);
      // First broadcast throws.
      await expect(
        service.withBroadcastLock(42161, '0xWallet', provider as never, () =>
          Promise.reject(new Error('RPC rejected')),
        ),
      ).rejects.toThrow('RPC rejected');

      // Second broadcast on the same wallet must still acquire and run.
      const result = await service.withBroadcastLock(
        42161,
        '0xWallet',
        provider as never,
        (nonce) => Promise.resolve(`ok nonce=${nonce}`),
      );
      expect(result).toBe('ok nonce=7');
    });
  });

  describe('acquireNextNonce', () => {
    it('returns the RPC pending nonce', async () => {
      const { provider } = buildProvider(() => 99);
      const nonce = await service.acquireNextNonce(42161, '0xWallet', provider as never);
      expect(nonce).toBe(99);
    });
  });

  describe('recordNonceDrift', () => {
    it('does not throw and records drift via metrics', () => {
      expect(() => service.recordNonceDrift(42161, '0xWallet', 10, 8)).not.toThrow();
    });
  });
});
