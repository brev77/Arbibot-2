import { HermesClient } from '../hermes-client.js';
import { registerAlertTools } from './alerts.js';
import type { McpServerHandle } from './helper.js';

/**
 * alerts.ts tool registration + handler (P7-7 — Hermes alert pipeline).
 *
 * Asserts: registration (1 tool, name), GET to `/alerts`, optional `?status=`
 * filter forwarding, and JSON-stringified text response. This tool is the
 * MCP-side counterpart of hermes-gateway `GET /hermes/v1/alerts` and feeds the
 * `alert_watch` cron → Telegram forward path.
 */
describe('alertmanager incident tools', () => {
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

  it('registers 1 alertmanager tool', () => {
    registerAlertTools(mockServer, buildClient());
    expect(names).toHaveLength(1);
    expect(names).toEqual(['list_alertmanager_incidents']);
  });

  it('list_alertmanager_incidents issues GET to /alerts without status', async () => {
    registerAlertTools(mockServer, buildClient());
    const fetchFn = mockOk({ items: [] });
    await captured.get('list_alertmanager_incidents')!({});
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toMatch(/\/alerts$/);
    expect((init as RequestInit).method).toBe('GET');
  });

  it('forwards ?status= when provided', async () => {
    registerAlertTools(mockServer, buildClient());
    const fetchFn = mockOk({ items: [{ id: 'a1' }] });
    await captured.get('list_alertmanager_incidents')!({ status: 'firing' });
    const [url] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain('/alerts?status=firing');
  });

  it('omits ?status when undefined', async () => {
    registerAlertTools(mockServer, buildClient());
    const fetchFn = mockOk({ items: [] });
    await captured.get('list_alertmanager_incidents')!({});
    const [url] = fetchFn.mock.calls[0]!;
    expect(String(url)).not.toContain('?status=');
  });

  it('returns JSON-stringified payload as text content', async () => {
    registerAlertTools(mockServer, buildClient());
    mockOk({ items: [{ id: 'a1', alertname: 'DiskSpaceCritical' }] });
    const out = (await captured.get('list_alertmanager_incidents')!({})) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(out.content).toHaveLength(1);
    expect(out.content[0]?.type).toBe('text');
    expect(JSON.parse(out.content[0]?.text ?? '')).toEqual({
      items: [{ id: 'a1', alertname: 'DiskSpaceCritical' }],
    });
  });
});
