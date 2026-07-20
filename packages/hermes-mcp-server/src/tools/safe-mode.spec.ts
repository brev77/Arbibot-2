import { HermesClient } from '../hermes-client.js';
import type { McpServerHandle } from './helper.js';
import { registerSafeModeTools } from './safe-mode.js';

/**
 * safe-mode.ts tool registration + handlers.
 *
 * Three tools over the gateway `/safe-mode/*` surface: status (GET), enable
 * (POST), disable (POST). We assert: registration count + names, GET/POST
 * dispatch, response JSON-stringified as text content.
 */
describe('safe-mode tools', () => {
  let captured: Map<string, (...args: unknown[]) => Promise<unknown>>;
  let names: string[];
  let mockServer: McpServerHandle;

  beforeEach(() => {
    captured = new Map();
    names = [];
    mockServer = {
      tool: (name: string, _description: string, _schema: unknown, handler: unknown) => {
        names.push(name);
        captured.set(name, handler as (...args: unknown[]) => Promise<unknown>);
      },
    } as unknown as McpServerHandle;
  });

  const buildClient = () =>
    new HermesClient({ gatewayUrl: 'http://localhost:3020', apiKey: 'k' });

  const mockOk = (payload: unknown) => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchFn);
    return fetchFn;
  };

  it('registers 3 safe-mode tools', () => {
    registerSafeModeTools(mockServer, buildClient());
    expect(names).toHaveLength(3);
    expect(names.sort()).toEqual(
      ['get_safe_mode_status', 'enable_safe_mode', 'disable_safe_mode'].sort(),
    );
  });

  it('get_safe_mode_status issues GET to /safe-mode/status', async () => {
    registerSafeModeTools(mockServer, buildClient());
    const fetchFn = mockOk({ enabled: false });
    await captured.get('get_safe_mode_status')!({});
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toMatch(/\/safe-mode\/status$/);
    expect((init as RequestInit).method).toBe('GET');
  });

  it('get_safe_mode_status returns JSON-stringified payload as text content', async () => {
    registerSafeModeTools(mockServer, buildClient());
    mockOk({ enabled: true, reason: 'drill' });
    const out = (await captured.get('get_safe_mode_status')!({})) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(out.content).toHaveLength(1);
    expect(out.content[0]?.type).toBe('text');
    expect(JSON.parse(out.content[0]?.text ?? '')).toEqual({
      enabled: true,
      reason: 'drill',
    });
  });

  it('enable_safe_mode issues POST to /safe-mode/enable', async () => {
    registerSafeModeTools(mockServer, buildClient());
    const fetchFn = mockOk({ enabled: true });
    await captured.get('enable_safe_mode')!({});
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toMatch(/\/safe-mode\/enable$/);
    expect((init as RequestInit).method).toBe('POST');
  });

  it('disable_safe_mode issues POST to /safe-mode/disable', async () => {
    registerSafeModeTools(mockServer, buildClient());
    const fetchFn = mockOk({ enabled: false });
    await captured.get('disable_safe_mode')!({});
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toMatch(/\/safe-mode\/disable$/);
    expect((init as RequestInit).method).toBe('POST');
  });
});
