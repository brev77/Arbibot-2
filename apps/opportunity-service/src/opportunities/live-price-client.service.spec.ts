// signedFetch is the outbound transport; mock it at the module boundary.
jest.mock('@arbibot/nest-platform', () => {
  const actual = jest.requireActual('@arbibot/nest-platform');
  return { ...actual, signedFetch: jest.fn() };
});

import { signedFetch } from '@arbibot/nest-platform';

import { LivePriceClientService } from './live-price-client.service';

const mockSignedFetch = signedFetch as unknown as jest.Mock;

/**
 * LivePriceClientService spec (PLAN12 #48).
 *
 * Non-throwing HTTP client to EO `GET /execution/price/:chainId/:tokenAddress`. Returns
 * the numeric price on success, null on any failure (network error, non-OK status,
 * missing/invalid `priceUsd` field, oracle fail-closed null). Mirrors the
 * `RiskClientService.getRiskDecision` resilience pattern — the worker skips with
 * `skip_no_price` rather than crashing the tick.
 */
describe('LivePriceClientService', () => {
  const originalEnv = process.env;
  let service: LivePriceClientService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.EXECUTION_API_BASE = 'http://eo:3012';
    mockSignedFetch.mockReset();
    service = new LivePriceClientService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function jsonResponse(body: unknown, status = 200): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(JSON.stringify(body)),
    } as Response;
  }

  function emptyResponse(status: number): Response {
    return { ok: false, status, text: () => Promise.resolve('') } as Response;
  }

  it('returns the numeric priceUsd on success', async () => {
    mockSignedFetch.mockResolvedValue(jsonResponse({ chainId: 42161, tokenAddress: '0x82a…', priceUsd: 2600.5 }));
    const price = await service.getTokenPriceUsd(42161, '0x82af49447d8a07e3bd95bd0d56f35241523fbab1');
    expect(price).toBe(2600.5);
    expect(mockSignedFetch).toHaveBeenCalledWith(
      'http://eo:3012/execution/price/42161/0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('passes through a stable price ($1) for USDC', async () => {
    mockSignedFetch.mockResolvedValue(jsonResponse({ chainId: 42161, tokenAddress: '0xaf88…', priceUsd: 1 }));
    const price = await service.getTokenPriceUsd(42161, '0xaf88d065e77c8cc2239327c5edb3a432268e5831');
    expect(price).toBe(1);
  });

  it('returns null when the oracle cannot price the token (priceUsd: null, HTTP 200)', async () => {
    mockSignedFetch.mockResolvedValue(jsonResponse({ chainId: 42161, tokenAddress: '0xdead', priceUsd: null }));
    const price = await service.getTokenPriceUsd(42161, '0xdeadbeef00000000000000000000000000000000');
    expect(price).toBeNull();
  });

  it('returns null on network error (signedFetch rejects)', async () => {
    mockSignedFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    const price = await service.getTokenPriceUsd(42161, '0x82af49447d8a07e3bd95bd0d56f35241523fbab1');
    expect(price).toBeNull();
  });

  it('returns null on timeout (AbortError)', async () => {
    const err = new Error('The operation was aborted');
    err.name = 'TimeoutError';
    mockSignedFetch.mockRejectedValue(err);
    const price = await service.getTokenPriceUsd(42161, '0x82af49447d8a07e3bd95bd0d56f35241523fbab1');
    expect(price).toBeNull();
  });

  it('returns null on non-OK status (500)', async () => {
    mockSignedFetch.mockResolvedValue(emptyResponse(500));
    const price = await service.getTokenPriceUsd(42161, '0x82af49447d8a07e3bd95bd0d56f35241523fbab1');
    expect(price).toBeNull();
  });

  it('returns null on non-OK status (404)', async () => {
    mockSignedFetch.mockResolvedValue(emptyResponse(404));
    const price = await service.getTokenPriceUsd(42161, '0x82af49447d8a07e3bd95bd0d56f35241523fbab1');
    expect(price).toBeNull();
  });

  it('returns null on non-JSON body', async () => {
    const res = { ok: true, status: 200, text: () => Promise.resolve('not json') } as Response;
    mockSignedFetch.mockResolvedValue(res);
    const price = await service.getTokenPriceUsd(42161, '0x82af49447d8a07e3bd95bd0d56f35241523fbab1');
    expect(price).toBeNull();
  });

  it('returns null when priceUsd field is missing', async () => {
    mockSignedFetch.mockResolvedValue(jsonResponse({ chainId: 42161, tokenAddress: '0x82a' }));
    const price = await service.getTokenPriceUsd(42161, '0x82af49447d8a07e3bd95bd0d56f35241523fbab1');
    expect(price).toBeNull();
  });

  it('returns null when priceUsd is non-numeric (string)', async () => {
    mockSignedFetch.mockResolvedValue(jsonResponse({ priceUsd: '2600' }));
    const price = await service.getTokenPriceUsd(42161, '0x82af49447d8a07e3bd95bd0d56f35241523fbab1');
    expect(price).toBeNull();
  });

  it('returns null when priceUsd is zero or negative (unusable)', async () => {
    mockSignedFetch.mockResolvedValue(jsonResponse({ priceUsd: 0 }));
    expect(await service.getTokenPriceUsd(42161, '0x82af49447d8a07e3bd95bd0d56f35241523fbab1')).toBeNull();
    mockSignedFetch.mockResolvedValue(jsonResponse({ priceUsd: -5 }));
    expect(await service.getTokenPriceUsd(42161, '0x82af49447d8a07e3bd95bd0d56f35241523fbab1')).toBeNull();
  });

  it('uses the default EO base URL when EXECUTION_API_BASE is unset', async () => {
    delete process.env.EXECUTION_API_BASE;
    const s = new LivePriceClientService();
    mockSignedFetch.mockResolvedValue(jsonResponse({ priceUsd: 1 }));
    await s.getTokenPriceUsd(42161, '0xaf88d065e77c8cc2239327c5edb3a432268e5831');
    expect(mockSignedFetch.mock.calls[0][0]).toContain('127.0.0.1:3012');
  });

  it('strips a trailing slash from EXECUTION_API_BASE', async () => {
    process.env.EXECUTION_API_BASE = 'http://eo:3012/';
    const s = new LivePriceClientService();
    mockSignedFetch.mockResolvedValue(jsonResponse({ priceUsd: 1 }));
    await s.getTokenPriceUsd(42161, '0xaf88d065e77c8cc2239327c5edb3a432268e5831');
    expect(mockSignedFetch.mock.calls[0][0]).toBe(
      'http://eo:3012/execution/price/42161/0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    );
  });
});
