import {
  MISMATCH_KIND_DEX_RECEIPT_LEG_MISMATCH,
  MISMATCH_KIND_DEX_STALE_PENDING_TX,
  MISMATCH_KIND_WALLET_BALANCE_DRIFT,
  runDexDetectors,
} from './dex-reconciliation.detectors';

describe('DEX reconciliation detectors', () => {
  const query = jest.fn();
  const dataSource = { query } as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('runDexDetectors', () => {
    it('returns zero inserted when all detectors find nothing', async () => {
      query.mockResolvedValueOnce([]) // receipt-leg
        .mockResolvedValueOnce([])    // wallet-balance
        .mockResolvedValueOnce([]);   // stale-pending

      const result = await runDexDetectors(dataSource);

      expect(result.inserted).toBe(0);
      expect(result.byKind).toMatchObject({
        [MISMATCH_KIND_DEX_RECEIPT_LEG_MISMATCH]: 0,
        [MISMATCH_KIND_WALLET_BALANCE_DRIFT]: 0,
        [MISMATCH_KIND_DEX_STALE_PENDING_TX]: 0,
      });
    });

    it('sums inserted rows from all three detectors', async () => {
      query.mockResolvedValueOnce([{ id: '1' }])       // receipt-leg: 1
        .mockResolvedValueOnce([{ id: '2' }, { id: '3' }]) // wallet-balance: 2
        .mockResolvedValueOnce([{ id: '4' }]);          // stale-pending: 1

      const result = await runDexDetectors(dataSource);

      expect(result.inserted).toBe(4);
      expect(result.byKind).toMatchObject({
        [MISMATCH_KIND_DEX_RECEIPT_LEG_MISMATCH]: 1,
        [MISMATCH_KIND_WALLET_BALANCE_DRIFT]: 2,
        [MISMATCH_KIND_DEX_STALE_PENDING_TX]: 1,
      });
    });

    it('passes custom thresholds to wallet balance and stale detectors', async () => {
      query.mockResolvedValueOnce([])  // receipt-leg
        .mockResolvedValueOnce([])     // wallet-balance (balanceDriftHours=48)
        .mockResolvedValueOnce([]);    // stale-pending (stalePendingHours=2)

      await runDexDetectors(dataSource, 2, 48);

      // wallet balance drift query uses $2 = driftHours
      expect(query).toHaveBeenNthCalledWith(2, expect.any(String), [
        MISMATCH_KIND_WALLET_BALANCE_DRIFT,
        48,
      ]);
      // stale pending query uses $2 = staleHours
      expect(query).toHaveBeenNthCalledWith(3, expect.any(String), [
        MISMATCH_KIND_DEX_STALE_PENDING_TX,
        2,
      ]);
    });
  });

  describe('DexReceiptLegMismatchDetector', () => {
    it('uses correct kind constant', () => {
      expect(MISMATCH_KIND_DEX_RECEIPT_LEG_MISMATCH).toBe(
        'dex_receipt_leg_mismatch',
      );
    });
  });

  describe('WalletBalanceDriftDetector', () => {
    it('uses correct kind constant', () => {
      expect(MISMATCH_KIND_WALLET_BALANCE_DRIFT).toBe('wallet_balance_drift');
    });
  });

  describe('DexStalePendingTxDetector', () => {
    it('uses correct kind constant', () => {
      expect(MISMATCH_KIND_DEX_STALE_PENDING_TX).toBe('dex_stale_pending_tx');
    });
  });
});