import { registerConfigTools } from './config.js';
import type { McpServerHandle } from './helper.js';
import { HermesClient } from '../hermes-client.js';

/**
 * config.ts tool registration + handlers (Plan 6).
 *
 * Verifies:
 *  - 8 tools registered (4 read + 4 mutation).
 *  - Mutation tool descriptions contain "(mutation" marker (the external
 *    agent relies on description strings to identify approval-gated tools).
 *  - Read tools issue GET without a body.
 *  - Mutation tools issue PUT/POST/PATCH on the correct path and inject
 *    `operatorId` + `approveReason` into the body.
 *  - Missing operatorId produces an actionable error.
 */
describe('config tools', () => {
  let captured: Map<string, (...args: unknown[]) => Promise<unknown>>;
  let names: string[];
  let descriptions: Record<string, string>;
  let mockServer: McpServerHandle;

  const buildClient = (operatorIdEnv?: string) => {
    const oldOp = process.env.HERMES_OPERATOR_ID;
    const oldTel = process.env.OPERATOR_TELEGRAM_ID;
    if (operatorIdEnv === undefined) {
      delete process.env.HERMES_OPERATOR_ID;
      delete process.env.OPERATOR_TELEGRAM_ID;
    } else {
      process.env.HERMES_OPERATOR_ID = operatorIdEnv;
    }
    const client = new HermesClient({ gatewayUrl: 'http://localhost:3020', apiKey: 'k' });
    delete process.env.HERMES_OPERATOR_ID;
    delete process.env.OPERATOR_TELEGRAM_ID;
    process.env.HERMES_OPERATOR_ID = oldOp;
    process.env.OPERATOR_TELEGRAM_ID = oldTel;
    return client;
  };

  beforeEach(() => {
    captured = new Map();
    names = [];
    descriptions = {};
    mockServer = {
      tool: (name: string, description: string, _schema: unknown, handler: unknown) => {
        names.push(name);
        descriptions[name] = description;
        captured.set(name, handler as (...args: unknown[]) => Promise<unknown>);
      },
    } as unknown as McpServerHandle;
  });

  it('registers 8 config tools', () => {
    registerConfigTools(mockServer, buildClient('op-1'));
    expect(names).toHaveLength(8);
    expect(names.sort()).toEqual(
      [
        'list_configs',
        'get_config',
        'get_effective_config',
        'get_config_history',
        'update_config',
        'rollback_config',
        'promote_config',
        'activate_config',
      ].sort(),
    );
  });

  it('mutation tool descriptions contain "(mutation"', () => {
    registerConfigTools(mockServer, buildClient('op-1'));
    for (const name of ['update_config', 'rollback_config', 'promote_config', 'activate_config']) {
      expect(descriptions[name]).toMatch(/\(mutation/i);
    }
  });

  it('read tools issue GET without a body', async () => {
    const client = buildClient('op-1');
    registerConfigTools(mockServer, client);
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ configKey: 'dex.limits' }]),
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await captured.get('list_configs')!({ scopeType: 'global' });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(String(url)).toContain('/config?scopeType=global');
    expect((init as RequestInit).method).toBe('GET');
    expect((init as RequestInit).body).toBeUndefined();
  });

  it('get_config hits /config/:key with optional scope query', async () => {
    const client = buildClient('op-1');
    registerConfigTools(mockServer, client);
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ configKey: 'dex.limits', configValue: '{}' }),
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await captured.get('get_config')!({ configKey: 'dex.limits' });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(String(url)).toContain('/config/dex.limits');
    expect((init as RequestInit).method).toBe('GET');
  });

  it('update_config issues PUT with operatorId + approveReason', async () => {
    const client = buildClient('op-42');
    registerConfigTools(mockServer, client);
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await captured.get('update_config')!({
      configKey: 'intake.throttling',
      configValue: '{"enabled":true}',
      approveReason: 'tighten throttle',
    });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(String(url)).toContain('/config/intake.throttling');
    expect((init as RequestInit).method).toBe('PUT');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      operatorId: 'op-42',
      approveReason: 'tighten throttle',
      configValue: '{"enabled":true}',
    });
  });

  it('rollback_config issues POST to /rollback with toVersion', async () => {
    const client = buildClient('op-42');
    registerConfigTools(mockServer, client);
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ rollbackId: 'r1' }),
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await captured.get('rollback_config')!({
      configKey: 'dex.limits',
      toVersion: 3,
      approveReason: 'revert bad tuning',
    });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(String(url)).toContain('/config/dex.limits/rollback');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      operatorId: 'op-42',
      toVersion: 3,
      approveReason: 'revert bad tuning',
    });
  });

  it('promote_config issues POST to /promote with from/to scope', async () => {
    const client = buildClient('op-42');
    registerConfigTools(mockServer, client);
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await captured.get('promote_config')!({
      configKey: 'paper.discovery',
      fromScopeType: 'global',
      toScopeType: 'environment',
      toScopeValue: 'staging',
      approveReason: 'promote to staging',
    });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(String(url)).toContain('/config/paper.discovery/promote');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      operatorId: 'op-42',
      fromScopeType: 'global',
      toScopeType: 'environment',
      toScopeValue: 'staging',
    });
  });

  it('activate_config issues PATCH to /status with status=active', async () => {
    const client = buildClient('op-42');
    registerConfigTools(mockServer, client);
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(mockFetch);

    await captured.get('activate_config')!({
      configKey: 'features.flags',
      approveReason: 'activate draft',
    });
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(String(url)).toContain('/config/features.flags/status');
    expect((init as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      operatorId: 'op-42',
      status: 'active',
      approveReason: 'activate draft',
    });
  });

  it('mutation tools throw an actionable error when operatorId is unset', async () => {
    const client = buildClient(undefined); // no HERMES_OPERATOR_ID, no OPERATOR_TELEGRAM_ID
    registerConfigTools(mockServer, client);
    jest.spyOn(globalThis, 'fetch');

    await expect(
      captured.get('update_config')!({
        configKey: 'intake.throttling',
        configValue: '{}',
        approveReason: 'x',
      }),
    ).rejects.toThrow(/operatorId is not configured/);
  });
});
