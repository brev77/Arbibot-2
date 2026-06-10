import { HermesClient } from './hermes-client.js';

describe('HermesClient', () => {
  const config = { gatewayUrl: 'http://localhost:3020', apiKey: 'test-key' };
  let client: HermesClient;

  beforeEach(() => {
    client = new HermesClient(config);
    jest.restoreAllMocks();
  });

  it('should send GET with auth header', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ id: '1' }]),
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const result = await client.get<unknown[]>('/plans');
    expect(result).toEqual([{ id: '1' }]);

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3020/hermes/v1/plans',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'x-hermes-api-key': 'test-key' }),
      }),
    );
  });

  it('should send POST with body', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await client.post('/plans/123/arm');
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3020/hermes/v1/plans/123/arm',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('should throw on non-ok response', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    } as Response);

    await expect(client.get('/plans')).rejects.toThrow('Hermes gateway 401');
  });

  it('should throw on 404', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not found'),
    } as Response);

    await expect(client.get('/plans/bad-id')).rejects.toThrow('Hermes gateway 404');
  });

  it('should throw on 500', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal error'),
    } as Response);

    await expect(client.get('/plans')).rejects.toThrow('Hermes gateway 500');
  });

  it('should throw on 429 rate limit', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('Too many requests'),
    } as Response);

    await expect(client.get('/plans')).rejects.toThrow('Hermes gateway 429');
  });

  it('should handle text() rejection gracefully', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.reject(new Error('stream error')),
    } as unknown as Response);

    await expect(client.get('/plans')).rejects.toThrow('Hermes gateway 502: unknown error');
  });

  it('should work without API key', async () => {
    const noKeyConfig = { gatewayUrl: 'http://localhost:3020', apiKey: '' };
    const c = new HermesClient(noKeyConfig);

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await c.get('/plans');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.not.objectContaining({ 'x-hermes-api-key': expect.anything() }),
      }),
    );
  });
});