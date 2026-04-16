import { runWithCorrelationId } from './correlation';

import { AuditClientService } from './audit-client.service';

describe('AuditClientService', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = process.env;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('sends correlation from ALS when input omits it', async () => {
    process.env.AUDIT_SERVICE_URL = 'http://audit.test';
    process.env.AUDIT_CLIENT_ENABLED = 'true';

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new AuditClientService();

    await runWithCorrelationId('als-corr-1', async () => {
      await svc.appendEntry({
        actor: 'unit',
        action: 'Test',
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(init?.headers).toMatchObject({
      'x-correlation-id': 'als-corr-1',
    });
    const rawBody = init?.body;
    if (typeof rawBody !== 'string') {
      throw new Error('expected string request body');
    }
    const body = JSON.parse(rawBody) as {
      correlationId: string | undefined;
    };
    expect(body.correlationId).toBe('als-corr-1');
  });

  it('prefers explicit correlationId over ALS', async () => {
    process.env.AUDIT_SERVICE_URL = 'http://audit.test';

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const svc = new AuditClientService();

    await runWithCorrelationId('als-corr-2', async () => {
      await svc.appendEntry({
        correlationId: 'explicit',
        actor: 'unit',
        action: 'Test',
      });
    });

    const [, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    expect(init?.headers).toMatchObject({
      'x-correlation-id': 'explicit',
    });
  });
});
