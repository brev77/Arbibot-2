import { HermesClient } from '../hermes-client.js';
import type { McpServerHandle } from './helper.js';
import { registerAuditTools } from './audit.js';
import { registerPositionTools } from './positions.js';
import { registerPlanTools } from './plans.js';

/**
 * Combined spec for the thinner tool modules: audit, positions, plans.
 *
 * Each tool is a thin wrapper around `HermesClient.get/post` returning a
 * text-content payload with JSON-stringified data. We assert: registration
 * count + names, GET/POST dispatch on the correct path, response shape.
 */
describe('misc tool modules', () => {
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

  describe('audit tools', () => {
    it('registers 1 audit tool', () => {
      registerAuditTools(mockServer, buildClient());
      expect(names).toEqual(['get_approvals_queue']);
    });

    it('get_approvals_queue issues GET to /approvals-queue', async () => {
      registerAuditTools(mockServer, buildClient());
      const fetchFn = mockOk([{ id: 'a-1' }]);
      await captured.get('get_approvals_queue')!({});
      const [url, init] = fetchFn.mock.calls[0]!;
      expect(String(url)).toMatch(/\/approvals-queue$/);
      expect((init as RequestInit).method).toBe('GET');
    });

    it('get_approvals_queue returns JSON-stringified payload', async () => {
      registerAuditTools(mockServer, buildClient());
      mockOk([{ id: 'a-1', state: 'pending' }]);
      const out = (await captured.get('get_approvals_queue')!({})) as {
        content: Array<{ type: string; text: string }>;
      };
      expect(out.content[0]?.type).toBe('text');
      expect(JSON.parse(out.content[0]?.text ?? '')).toEqual([
        { id: 'a-1', state: 'pending' },
      ]);
    });
  });

  describe('position tools', () => {
    it('registers 2 position tools', () => {
      registerPositionTools(mockServer, buildClient());
      expect(names.sort()).toEqual(['list_positions', 'close_position'].sort());
    });

    it('list_positions issues GET to /positions', async () => {
      registerPositionTools(mockServer, buildClient());
      const fetchFn = mockOk([]);
      await captured.get('list_positions')!({});
      const [url, init] = fetchFn.mock.calls[0]!;
      expect(String(url)).toMatch(/\/positions$/);
      expect((init as RequestInit).method).toBe('GET');
    });

    it('close_position issues POST to /positions/:id/close', async () => {
      registerPositionTools(mockServer, buildClient());
      const fetchFn = mockOk({ closed: true });
      await captured.get('close_position')!({ positionId: 'pos-7' });
      const [url, init] = fetchFn.mock.calls[0]!;
      expect(String(url)).toMatch(/\/positions\/pos-7\/close$/);
      expect((init as RequestInit).method).toBe('POST');
    });
  });

  describe('plan tools', () => {
    it('registers 4 plan tools', () => {
      registerPlanTools(mockServer, buildClient());
      expect(names.sort()).toEqual(
        ['list_plans', 'get_plan', 'arm_plan', 'execute_plan'].sort(),
      );
    });

    it('list_plans issues GET to /plans', async () => {
      registerPlanTools(mockServer, buildClient());
      const fetchFn = mockOk([]);
      await captured.get('list_plans')!({});
      const [url, init] = fetchFn.mock.calls[0]!;
      expect(String(url)).toMatch(/\/plans$/);
      expect((init as RequestInit).method).toBe('GET');
    });

    it('get_plan issues GET to /plans/:id', async () => {
      registerPlanTools(mockServer, buildClient());
      const fetchFn = mockOk({ id: 'p-1' });
      await captured.get('get_plan')!({ planId: 'p-1' });
      const [url, init] = fetchFn.mock.calls[0]!;
      expect(String(url)).toMatch(/\/plans\/p-1$/);
      expect((init as RequestInit).method).toBe('GET');
    });

    it('arm_plan issues POST to /plans/:id/arm', async () => {
      registerPlanTools(mockServer, buildClient());
      const fetchFn = mockOk({ armed: true });
      await captured.get('arm_plan')!({ planId: 'p-2' });
      const [url, init] = fetchFn.mock.calls[0]!;
      expect(String(url)).toMatch(/\/plans\/p-2\/arm$/);
      expect((init as RequestInit).method).toBe('POST');
    });

    it('execute_plan issues POST to /plans/:id/execute', async () => {
      registerPlanTools(mockServer, buildClient());
      const fetchFn = mockOk({ executing: true });
      await captured.get('execute_plan')!({ planId: 'p-3' });
      const [url, init] = fetchFn.mock.calls[0]!;
      expect(String(url)).toMatch(/\/plans\/p-3\/execute$/);
      expect((init as RequestInit).method).toBe('POST');
    });
  });
});
