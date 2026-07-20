// signedFetch is the outbound transport; mock it at the module boundary so the
// spec exercises request/response handling without any real HTTP. Auto-hoisted.
jest.mock('@arbibot/nest-platform', () => {
  const actual = jest.requireActual('@arbibot/nest-platform');
  return {
    ...actual,
    signedFetch: jest.fn(),
  };
});

import { signedFetch } from '@arbibot/nest-platform';

import { HermesUpstreamService } from './hermes-upstream.service';

const mockSignedFetch = signedFetch as unknown as jest.Mock;

/** Build a minimal Response double with a text() body. */
const mkResponse = (status: number, body: string): Response =>
  ({
    status,
    text: () => Promise.resolve(body),
  }) as unknown as Response;

describe('HermesUpstreamService', () => {
  const originalEnv = process.env;
  let service: HermesUpstreamService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.HERMES_SIGN_UPSTREAM;
    mockSignedFetch.mockReset();
    service = new HermesUpstreamService();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getJson', () => {
    it('GETs JSON and returns {status, json}, no correlation header when omitted', async () => {
      mockSignedFetch.mockResolvedValue(mkResponse(200, '{"ok":true}'));

      const result = await service.getJson('http://up/plans');

      expect(result).toEqual({ status: 200, json: { ok: true } });
      expect(mockSignedFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockSignedFetch.mock.calls[0]!;
      expect(url).toBe('http://up/plans');
      expect(init).toMatchObject({
        method: 'GET',
        forceSign: false,
      });
      // No correlation header when none provided.
      expect(init.headers).toEqual({});
    });

    it('forwards x-correlation-id when provided', async () => {
      mockSignedFetch.mockResolvedValue(mkResponse(200, '[]'));

      await service.getJson('http://up', 'corr-123');

      const init = mockSignedFetch.mock.calls[0]![1];
      expect(init.headers).toEqual({ 'x-correlation-id': 'corr-123' });
    });

    it('returns json=null when body is empty', async () => {
      mockSignedFetch.mockResolvedValue(mkResponse(204, ''));

      const result = await service.getJson('http://up');

      expect(result).toEqual({ status: 204, json: null });
    });

    it('returns {raw: text} when body is non-JSON (no throw)', async () => {
      mockSignedFetch.mockResolvedValue(mkResponse(200, 'not-json'));

      const result = await service.getJson('http://up');

      expect(result).toEqual({ status: 200, json: { raw: 'not-json' } });
    });

    it('rethrows when signedFetch rejects (logs warning, no swallow)', async () => {
      const err = new Error('ECONNREFUSED');
      mockSignedFetch.mockRejectedValue(err);

      await expect(service.getJson('http://up')).rejects.toBe(err);
    });

    it('rethrows non-Error throws (String(err) in message)', async () => {
      mockSignedFetch.mockRejectedValue('string-thrown');

      await expect(service.getJson('http://up')).rejects.toBe('string-thrown');
    });

    it('passes forceSign=true to signedFetch when HERMES_SIGN_UPSTREAM=true', async () => {
      process.env.HERMES_SIGN_UPSTREAM = 'true';
      const signedService = new HermesUpstreamService();
      mockSignedFetch.mockResolvedValue(mkResponse(200, '{}'));

      await signedService.getJson('http://up');

      expect(mockSignedFetch.mock.calls[0]![1].forceSign).toBe(true);
    });
  });

  describe('postJson', () => {
    it('POSTs with Content-Type + Accept + JSON body, returns parsed json', async () => {
      mockSignedFetch.mockResolvedValue(mkResponse(201, '{"id":"p1"}'));

      const result = await service.postJson(
        'http://up/plans',
        { action: 'arm' },
        'corr-1',
      );

      expect(result).toEqual({ status: 201, json: { id: 'p1' } });
      const init = mockSignedFetch.mock.calls[0]![1];
      expect(init).toMatchObject({
        method: 'POST',
        body: JSON.stringify({ action: 'arm' }),
      });
      expect(init.headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-correlation-id': 'corr-1',
      });
    });

    it('omits body when payload is undefined or empty object', async () => {
      mockSignedFetch.mockResolvedValue(mkResponse(202, ''));

      await service.postJson('http://up', undefined);

      const init = mockSignedFetch.mock.calls[0]![1];
      expect(init.body).toBeUndefined();
    });

    it('omits body when payload is an empty object {}', async () => {
      mockSignedFetch.mockResolvedValue(mkResponse(202, ''));

      await service.postJson('http://up', {});

      const init = mockSignedFetch.mock.calls[0]![1];
      expect(init.body).toBeUndefined();
    });

    it('rethrows when POST signedFetch rejects', async () => {
      mockSignedFetch.mockRejectedValue(new Error('post-failed'));

      await expect(
        service.postJson('http://up', { x: 1 }),
      ).rejects.toThrow('post-failed');
    });

    it('returns {raw} for non-JSON POST response body', async () => {
      mockSignedFetch.mockResolvedValue(mkResponse(500, 'Internal Error'));

      const result = await service.postJson('http://up', { x: 1 });

      expect(result).toEqual({ status: 500, json: { raw: 'Internal Error' } });
    });
  });

  describe('patchJson', () => {
    it('PATCHes with JSON body and returns parsed json', async () => {
      mockSignedFetch.mockResolvedValue(mkResponse(200, '{"ok":1}'));

      const result = await service.patchJson(
        'http://up/r/1',
        { status: 'active' },
        'corr-2',
      );

      expect(result).toEqual({ status: 200, json: { ok: 1 } });
      const init = mockSignedFetch.mock.calls[0]![1];
      expect(init).toMatchObject({
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' }),
      });
      expect(init.headers['x-correlation-id']).toBe('corr-2');
    });

    it('rethrows when PATCH signedFetch rejects', async () => {
      mockSignedFetch.mockRejectedValue(new Error('patch-failed'));

      await expect(
        service.patchJson('http://up', { s: 1 }),
      ).rejects.toThrow('patch-failed');
    });

    it('returns json=null for empty PATCH response', async () => {
      mockSignedFetch.mockResolvedValue(mkResponse(204, ''));

      const result = await service.patchJson('http://up', { s: 1 });

      expect(result).toEqual({ status: 204, json: null });
    });

    it('omits x-correlation-id when correlationId is undefined', async () => {
      mockSignedFetch.mockResolvedValue(mkResponse(200, '{}'));

      await service.patchJson('http://up', { s: 1 });

      const init = mockSignedFetch.mock.calls[0]![1];
      expect(init.headers['x-correlation-id']).toBeUndefined();
    });

    it('rethrows non-Error throws (String(err) in message)', async () => {
      mockSignedFetch.mockRejectedValue('patch-string-thrown');

      await expect(service.patchJson('http://up', { s: 1 })).rejects.toBe(
        'patch-string-thrown',
      );
    });

    it('returns {raw} for non-JSON PATCH response body', async () => {
      mockSignedFetch.mockResolvedValue(mkResponse(500, 'Server Error'));

      const result = await service.patchJson('http://up', { s: 1 });

      expect(result).toEqual({ status: 500, json: { raw: 'Server Error' } });
    });
  });

  describe('putJson', () => {
    it('PUTs with Content-Type + Accept + JSON body, returns parsed json', async () => {
      mockSignedFetch.mockResolvedValue(mkResponse(200, '{"configKey":"dex.limits"}'));

      const result = await service.putJson(
        'http://cfg/policy/configurations/dex.limits',
        { configValue: '{}', operatorId: 'op-1' },
        'corr-3',
      );

      expect(result).toEqual({ status: 200, json: { configKey: 'dex.limits' } });
      const init = mockSignedFetch.mock.calls[0]![1];
      expect(init).toMatchObject({
        method: 'PUT',
        body: JSON.stringify({ configValue: '{}', operatorId: 'op-1' }),
        forceSign: false,
      });
      expect(init.headers).toEqual({
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-correlation-id': 'corr-3',
      });
    });

    it('omits x-correlation-id when correlationId is undefined', async () => {
      mockSignedFetch.mockResolvedValue(mkResponse(200, '{}'));

      await service.putJson('http://cfg/x', { v: 1 });

      const init = mockSignedFetch.mock.calls[0]![1];
      expect(init.headers['x-correlation-id']).toBeUndefined();
    });

    it('rethrows when PUT signedFetch rejects', async () => {
      mockSignedFetch.mockRejectedValue(new Error('put-failed'));

      await expect(
        service.putJson('http://cfg/x', { v: 1 }),
      ).rejects.toThrow('put-failed');
    });

    it('rethrows non-Error throws (String(err) in message)', async () => {
      mockSignedFetch.mockRejectedValue('put-string-thrown');

      await expect(service.putJson('http://cfg/x', { v: 1 })).rejects.toBe(
        'put-string-thrown',
      );
    });

    it('returns json=null for empty PUT response', async () => {
      mockSignedFetch.mockResolvedValue(mkResponse(204, ''));

      const result = await service.putJson('http://cfg/x', { v: 1 });

      expect(result).toEqual({ status: 204, json: null });
    });

    it('returns {raw} for non-JSON PUT response body', async () => {
      mockSignedFetch.mockResolvedValue(mkResponse(500, 'Internal Error'));

      const result = await service.putJson('http://cfg/x', { v: 1 });

      expect(result).toEqual({ status: 500, json: { raw: 'Internal Error' } });
    });

    it('passes forceSign=true to signedFetch when HERMES_SIGN_UPSTREAM=true', async () => {
      process.env.HERMES_SIGN_UPSTREAM = 'true';
      const signedService = new HermesUpstreamService();
      mockSignedFetch.mockResolvedValue(mkResponse(200, '{}'));

      await signedService.putJson('http://cfg/x', { v: 1 });

      expect(mockSignedFetch.mock.calls[0]![1].forceSign).toBe(true);
    });
  });
});
