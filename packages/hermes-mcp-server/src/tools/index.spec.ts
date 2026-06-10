import { registerTools } from './index.js';
import type { McpServerHandle } from './helper.js';
import { HermesClient } from '../hermes-client.js';

describe('MCP Tools Registration', () => {
  let registeredTools: Array<{ name: string; description: string }>;
  let mockServer: McpServerHandle;
  let client: HermesClient;

  beforeEach(() => {
    registeredTools = [];
    mockServer = {
      tool: (name: string, description: string, _schema: unknown, _handler: unknown) => {
        registeredTools.push({ name, description });
      },
    } as unknown as McpServerHandle;
    client = new HermesClient({ gatewayUrl: 'http://localhost:3020', apiKey: 'test' });
  });

  it('should register exactly 14 tools', () => {
    registerTools(mockServer, client);
    expect(registeredTools).toHaveLength(14);
  });

  it('should register all expected tool names', () => {
    registerTools(mockServer, client);
    const names = registeredTools.map((t) => t.name).sort();
    expect(names).toEqual([
      'arm_plan',
      'close_position',
      'disable_safe_mode',
      'enable_safe_mode',
      'get_approvals_queue',
      'get_dashboard_summary',
      'get_plan',
      'get_safe_mode_status',
      'list_incident_briefs',
      'list_incidents',
      'list_plans',
      'list_positions',
      'resolve_incident',
      'execute_plan',
    ].sort());
  });

  it('every tool should have a non-empty description', () => {
    registerTools(mockServer, client);
    for (const tool of registeredTools) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });
});

describe('MCP Tool Handlers', () => {
  let capturedHandlers: Map<string, (...args: unknown[]) => Promise<unknown>>;
  let mockServer: McpServerHandle;
  let client: HermesClient;

  beforeEach(() => {
    capturedHandlers = new Map();
    mockServer = {
      tool: (name: string, _desc: string, _schema: unknown, handler: unknown) => {
        capturedHandlers.set(name, handler as (...args: unknown[]) => Promise<unknown>);
      },
    } as unknown as McpServerHandle;
    client = new HermesClient({ gatewayUrl: 'http://localhost:3020', apiKey: 'test' });
    registerTools(mockServer, client);
  });

  it('list_plans should call GET /plans', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ id: 'p1' }]),
    } as Response);

    const handler = capturedHandlers.get('list_plans')!;
    const result = (await handler({})) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toEqual([{ id: 'p1' }]);
  });

  it('get_plan should call GET /plans/:id', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'p1', state: 'planned' }),
    } as Response);

    const handler = capturedHandlers.get('get_plan')!;
    const result = (await handler({ planId: 'p1' })) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.id).toBe('p1');
  });

  it('arm_plan should call POST /plans/:id/arm', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ armed: true }),
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    const handler = capturedHandlers.get('arm_plan')!;
    await handler({ planId: 'p1' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/plans/p1/arm'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('list_positions should call GET /positions', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ id: 'pos1' }]),
    } as Response);

    const handler = capturedHandlers.get('list_positions')!;
    const result = (await handler({})) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toEqual([{ id: 'pos1' }]);
  });

  it('get_safe_mode_status should call GET /safe-mode/status', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ enabled: false }),
    } as Response);

    const handler = capturedHandlers.get('get_safe_mode_status')!;
    const result = (await handler({})) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.enabled).toBe(false);
  });

  it('get_dashboard_summary should call GET /dashboard/summary', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ incidents: 3 }),
    } as Response);

    const handler = capturedHandlers.get('get_dashboard_summary')!;
    const result = (await handler({})) as { content: Array<{ text: string }> };
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.incidents).toBe(3);
  });

  it('tool handler should propagate gateway errors', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    } as Response);

    const handler = capturedHandlers.get('list_plans')!;
    await expect(handler({})).rejects.toThrow('Hermes gateway 500');
  });
});