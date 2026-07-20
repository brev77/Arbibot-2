import { HermesClient } from '../hermes-client.js';
import { registerIncidentTools } from './incidents.js';
import type { McpServerHandle } from './helper.js';

/**
 * incidents.ts tool registration + handlers.
 *
 * Three read/mutation tools over the gateway `/incidents` + `/incident-briefs`
 * surface. We assert: registration count + names, GET/POST method dispatch,
 * query-string for `?limit=N`, and JSON-stringified text response.
 */
describe('incident tools', () => {
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

  it('registers 3 incident tools', () => {
    registerIncidentTools(mockServer, buildClient());
    expect(names).toHaveLength(3);
    expect(names.sort()).toEqual(
      ['list_incidents', 'resolve_incident', 'list_incident_briefs'].sort(),
    );
  });

  it('list_incidents issues GET to /incidents', async () => {
    registerIncidentTools(mockServer, buildClient());
    const fetchFn = mockOk([{ id: 'inc-1' }]);
    await captured.get('list_incidents')!({});
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toMatch(/\/incidents$/);
    expect((init as RequestInit).method).toBe('GET');
  });

  it('list_incidents forwards ?limit=N when provided', async () => {
    registerIncidentTools(mockServer, buildClient());
    const fetchFn = mockOk([]);
    await captured.get('list_incidents')!({ limit: 25 });
    const [url] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain('/incidents?limit=25');
  });

  it('list_incidents omits ?limit when undefined', async () => {
    registerIncidentTools(mockServer, buildClient());
    const fetchFn = mockOk([]);
    await captured.get('list_incidents')!({});
    const [url] = fetchFn.mock.calls[0]!;
    expect(String(url)).not.toContain('?');
  });

  it('list_incidents returns JSON-stringified payload as text content', async () => {
    registerIncidentTools(mockServer, buildClient());
    mockOk([{ id: 'inc-1', status: 'open' }]);
    const out = (await captured.get('list_incidents')!({})) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(out.content).toHaveLength(1);
    expect(out.content[0]?.type).toBe('text');
    expect(JSON.parse(out.content[0]?.text ?? '')).toEqual([
      { id: 'inc-1', status: 'open' },
    ]);
  });

  it('resolve_incident issues POST to /incidents/:id/resolve', async () => {
    registerIncidentTools(mockServer, buildClient());
    const fetchFn = mockOk({ resolved: true });
    await captured.get('resolve_incident')!({ incidentId: 'inc-9' });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toMatch(/\/incidents\/inc-9\/resolve$/);
    expect((init as RequestInit).method).toBe('POST');
  });

  it('list_incident_briefs issues GET to /incident-briefs', async () => {
    registerIncidentTools(mockServer, buildClient());
    const fetchFn = mockOk([{ summary: 'short' }]);
    await captured.get('list_incident_briefs')!({});
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toMatch(/\/incident-briefs$/);
    expect((init as RequestInit).method).toBe('GET');
  });
});
