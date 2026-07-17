// signedFetch is the outbound transport; mock it at the module boundary.
jest.mock('@arbibot/nest-platform', () => {
  const actual = jest.requireActual('@arbibot/nest-platform');
  return { ...actual, signedFetch: jest.fn() };
});

import { signedFetch } from '@arbibot/nest-platform';

import { PaperClientService } from './paper-client.service';

const mockSignedFetch = signedFetch as unknown as jest.Mock;

/**
 * PaperClientService spec (Phase 4 — opportunity→paper enqueue coverage).
 *
 * Env-gated HTTP client: when PAPER_TRADING_SERVICE_URL is unset, enqueue is
 * a no-op returning false. When set, it POSTs and returns true/false on
 * res.ok.
 */
describe('PaperClientService', () => {
  const originalEnv = process.env;
  let service: PaperClientService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PAPER_TRADING_SERVICE_URL;
    mockSignedFetch.mockReset();
    service = new PaperClientService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isEnabled', () => {
    it('returns false when PAPER_TRADING_SERVICE_URL is unset', () => {
      expect(service.isEnabled()).toBe(false);
    });

    it('returns true when the URL is set', () => {
      process.env.PAPER_TRADING_SERVICE_URL = 'http://paper:3018';
      const s = new PaperClientService();
      expect(s.isEnabled()).toBe(true);
    });

    it('returns false when the URL is whitespace-only', () => {
      process.env.PAPER_TRADING_SERVICE_URL = '   ';
      const s = new PaperClientService();
      expect(s.isEnabled()).toBe(false);
    });
  });

  describe('enqueuePromotionCandidate', () => {
    const body = {
      instrumentKey: 'BTC-USDT',
      opportunityId: '11111111-1111-4111-8111-111111111111',
      enqueueIdempotencyKey: 'idem-1',
    };

    it('returns false without calling signedFetch when disabled (no URL)', async () => {
      const result = await service.enqueuePromotionCandidate(body);

      expect(result).toBe(false);
      expect(mockSignedFetch).not.toHaveBeenCalled();
    });

    it('POSTs to {base}/paper/promotion-candidates and returns true on res.ok', async () => {
      process.env.PAPER_TRADING_SERVICE_URL = 'http://paper:3018/';
      const s = new PaperClientService();
      mockSignedFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });

      const result = await s.enqueuePromotionCandidate(body);

      expect(result).toBe(true);
      // Trailing slash stripped from the base URL.
      expect(mockSignedFetch.mock.calls[0]![0]).toBe(
        'http://paper:3018/paper/promotion-candidates',
      );
      const init = mockSignedFetch.mock.calls[0]![1];
      expect(init.method).toBe('POST');
      const sentBody = JSON.parse(init.body);
      expect(sentBody).toMatchObject({
        instrumentKey: 'BTC-USDT',
        opportunityId: '11111111-1111-4111-8111-111111111111',
        source: 'opportunity_hook', // default
        evidence: {}, // default
        enqueueIdempotencyKey: 'idem-1',
      });
    });

    it('returns false on non-ok response (logs warning, no throw)', async () => {
      process.env.PAPER_TRADING_SERVICE_URL = 'http://paper:3018';
      const s = new PaperClientService();
      mockSignedFetch.mockResolvedValue({
        ok: false,
        status: 409,
        text: () => Promise.resolve('conflict-detail'),
      });

      const result = await s.enqueuePromotionCandidate(body);

      expect(result).toBe(false);
    });

    it('forwards optional score/driftBps/source/evidence when provided', async () => {
      process.env.PAPER_TRADING_SERVICE_URL = 'http://paper:3018';
      const s = new PaperClientService();
      mockSignedFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve('') });

      await s.enqueuePromotionCandidate({
        ...body,
        source: 'discovery',
        score: 7.5,
        driftBps: 12,
        evidence: { route: 'BTC->ETH' },
      });

      const sentBody = JSON.parse(mockSignedFetch.mock.calls[0]![1].body);
      expect(sentBody.source).toBe('discovery');
      expect(sentBody.score).toBe(7.5);
      expect(sentBody.driftBps).toBe(12);
      expect(sentBody.evidence).toEqual({ route: 'BTC->ETH' });
    });
  });
});
