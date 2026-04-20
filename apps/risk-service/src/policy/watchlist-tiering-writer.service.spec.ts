import { WatchlistTieringWriterService } from './watchlist-tiering-writer.service';
import type { TokenProfileService } from './token-profile.service';
import type { WatchlistTierService } from './watchlist-tier.service';

describe('WatchlistTieringWriterService', () => {
  const originalHot = process.env.WATCHLIST_TIER_HOT_MIN_USD;
  const originalWarm = process.env.WATCHLIST_TIER_WARM_MIN_USD;

  afterEach(() => {
    if (originalHot === undefined) {
      delete process.env.WATCHLIST_TIER_HOT_MIN_USD;
    } else {
      process.env.WATCHLIST_TIER_HOT_MIN_USD = originalHot;
    }
    if (originalWarm === undefined) {
      delete process.env.WATCHLIST_TIER_WARM_MIN_USD;
    } else {
      process.env.WATCHLIST_TIER_WARM_MIN_USD = originalWarm;
    }
  });

  it('writes snapshot when tier changes', async () => {
    const tokens = {
      list: jest.fn().mockResolvedValue({
        items: [{ instrumentKey: 'BTC', maxNotionalUsd: 2_000_000, entityVersion: 1 }],
      }),
    } as unknown as TokenProfileService;
    const recordSnapshot = jest.fn().mockResolvedValue({ id: '1' });
    const watchlist = {
      findLatestForInstrument: jest.fn().mockResolvedValue({
        tier: 'cold',
        reason: 'old',
      }),
      recordSnapshot,
    } as unknown as WatchlistTierService;
    const svc = new WatchlistTieringWriterService(tokens, watchlist);
    const out = await svc.runCycle();
    expect(out.instrumentsEvaluated).toBe(1);
    expect(out.snapshotsWritten).toBe(1);
    expect(recordSnapshot).toHaveBeenCalledWith(
      'BTC',
      'hot',
      expect.stringContaining('tier=hot'),
    );
  });

  it('skips write when tier and reason unchanged', async () => {
    const tokens = {
      list: jest.fn().mockResolvedValue({
        items: [{ instrumentKey: 'ETH', maxNotionalUsd: 50_000, entityVersion: 1 }],
      }),
    } as unknown as TokenProfileService;
    const reason =
      'maxNotionalUsd=50000; tier=cold (< warmMin 100000 USD)';
    const recordSnapshot = jest.fn();
    const watchlist = {
      findLatestForInstrument: jest.fn().mockResolvedValue({
        tier: 'cold',
        reason,
      }),
      recordSnapshot,
    } as unknown as WatchlistTierService;
    const svc = new WatchlistTieringWriterService(tokens, watchlist);
    const out = await svc.runCycle();
    expect(out.snapshotsWritten).toBe(0);
    expect(recordSnapshot).not.toHaveBeenCalled();
  });
});
