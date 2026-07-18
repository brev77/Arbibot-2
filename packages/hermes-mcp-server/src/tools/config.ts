import { z } from 'zod';

import { HermesClient } from '../hermes-client.js';
import { registerTool, type McpServerHandle, type ToolResult } from './helper.js';

/**
 * Config-management MCP tools (Plan 6). Proxy to Hermes Gateway
 * `/hermes/v1/config/*` → config-service `/policy/configurations/*`.
 *
 * Gateway enforces an allowlist of mutable key patterns (intake/paper/
 * opportunity/dex/features); sensitive keys (risk/execution/capital) return
 * 403. Mutation tools MUST be added to `hermes-config.yaml →
 * security.approval_required` so the external agent asks the operator to
 * confirm before invoking.
 *
 * See docs/adr-hermes-config-management.md.
 */

/** Build `?k=v&k2=v2` (or '') from a record, skipping undefined/empty values. */
function buildQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' && v.length > 0) qs.set(k, v);
  }
  const s = qs.toString();
  return s.length > 0 ? `?${s}` : '';
}

/** Coerce an arg to a non-empty string, or undefined. */
function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export function registerConfigTools(server: McpServerHandle, client: HermesClient): void {
  // ── Read tools (executed immediately, no operator approval) ──────────

  registerTool(
    server,
    'list_configs',
    'List bot configuration keys (optionally filtered by scope)',
    {
      scopeType: z
        .enum(['global', 'environment', 'tenant'])
        .optional()
        .describe('Filter by scope type'),
      scopeValue: z.string().optional().describe('Scope value (e.g. environment name or tenant id)'),
    },
    async (args): Promise<ToolResult> => {
      const qs = buildQuery({
        scopeType: asStr(args.scopeType),
        scopeValue: asStr(args.scopeValue),
      });
      const data = await client.get<unknown>(`/config${qs}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  registerTool(
    server,
    'get_config',
    'Get a specific configuration key (current row)',
    {
      configKey: z.string().describe('Configuration key, e.g. "intake.throttling"'),
      scopeType: z.enum(['global', 'environment', 'tenant']).optional(),
      scopeValue: z.string().optional(),
    },
    async (args): Promise<ToolResult> => {
      const key = encodeURIComponent(asStr(args.configKey) ?? '');
      const qs = buildQuery({
        scopeType: asStr(args.scopeType),
        scopeValue: asStr(args.scopeValue),
      });
      const data = await client.get<unknown>(`/config/${key}${qs}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  registerTool(
    server,
    'get_effective_config',
    'Get the effective (scope-resolved) value of a configuration key',
    {
      configKey: z.string(),
      environment: z.string().optional().describe('Environment scope value'),
      tenantId: z.string().optional().describe('Tenant scope value'),
    },
    async (args): Promise<ToolResult> => {
      const key = encodeURIComponent(asStr(args.configKey) ?? '');
      const qs = buildQuery({
        environment: asStr(args.environment),
        tenantId: asStr(args.tenantId),
      });
      const data = await client.get<unknown>(`/config/${key}/effective${qs}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  registerTool(
    server,
    'get_config_history',
    'Get version history of a configuration key',
    {
      configKey: z.string(),
      scopeType: z.enum(['global', 'environment', 'tenant']).optional(),
      scopeValue: z.string().optional(),
    },
    async (args): Promise<ToolResult> => {
      const key = encodeURIComponent(asStr(args.configKey) ?? '');
      const qs = buildQuery({
        scopeType: asStr(args.scopeType),
        scopeValue: asStr(args.scopeValue),
      });
      const data = await client.get<unknown>(`/config/${key}/history${qs}`);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  // ── Mutation tools (require operator approval via Telegram) ──────────
  // operatorId is injected from HERMES_OPERATOR_ID | OPERATOR_TELEGRAM_ID.

  registerTool(
    server,
    'update_config',
    'Update a bot configuration value (mutation — safe keys only: intake/paper/opportunity/dex/features)',
    {
      configKey: z.string().describe('Configuration key to update, e.g. "dex.limits"'),
      configValue: z.string().describe('New JSON value as a string'),
      approveReason: z.string().describe('Why this change is being made (audited)'),
      scopeType: z.enum(['global', 'environment', 'tenant']).optional(),
      scopeValue: z.string().optional(),
      status: z.enum(['draft', 'active']).optional().describe('Row status (default active)'),
    },
    async (args): Promise<ToolResult> => {
      const body = mutationBody(client, args, ['configValue', 'scopeType', 'scopeValue', 'status']);
      const key = encodeURIComponent(asStr(args.configKey) ?? '');
      const data = await client.put<unknown>(`/config/${key}`, body);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  registerTool(
    server,
    'rollback_config',
    'Roll back a configuration key to a prior version (mutation — safe keys only)',
    {
      configKey: z.string(),
      toVersion: z.number().int().describe('Entity version to restore'),
      approveReason: z.string(),
      scopeType: z.enum(['global', 'environment', 'tenant']).optional(),
      scopeValue: z.string().optional(),
    },
    async (args): Promise<ToolResult> => {
      const body = mutationBody(client, args, ['toVersion', 'scopeType', 'scopeValue']);
      const key = encodeURIComponent(asStr(args.configKey) ?? '');
      const data = await client.post<unknown>(`/config/${key}/rollback`, body);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  registerTool(
    server,
    'promote_config',
    'Promote an active configuration row from one scope to another (mutation — safe keys only)',
    {
      configKey: z.string(),
      fromScopeType: z.enum(['global', 'environment', 'tenant']),
      toScopeType: z.enum(['global', 'environment', 'tenant']),
      approveReason: z.string(),
      fromScopeValue: z.string().optional(),
      toScopeValue: z.string().optional(),
      idempotencyKey: z.string().optional(),
    },
    async (args): Promise<ToolResult> => {
      const body = mutationBody(client, args, [
        'fromScopeType',
        'toScopeType',
        'fromScopeValue',
        'toScopeValue',
        'idempotencyKey',
      ]);
      const key = encodeURIComponent(asStr(args.configKey) ?? '');
      const data = await client.post<unknown>(`/config/${key}/promote`, body);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  registerTool(
    server,
    'activate_config',
    'Activate the latest draft of a configuration key in a scope (mutation — safe keys only)',
    {
      configKey: z.string(),
      approveReason: z.string(),
      scopeType: z.enum(['global', 'environment', 'tenant']).optional(),
      scopeValue: z.string().optional(),
    },
    async (args): Promise<ToolResult> => {
      const body = mutationBody(client, args, ['scopeType', 'scopeValue'], {
        status: 'active',
      });
      const key = encodeURIComponent(asStr(args.configKey) ?? '');
      const data = await client.patch<unknown>(`/config/${key}/status`, body);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );
}

/**
 * Build the gateway mutation body: injects `operatorId` from the client env
 * (HERMES_OPERATOR_ID | OPERATOR_TELEGRAM_ID) and copies the listed `fields`
 * from `args`. Throws a descriptive error when operatorId is unset so the
 * tool failure is actionable instead of a 400 from config-service.
 */
function mutationBody(
  client: HermesClient,
  args: Record<string, unknown>,
  fields: string[],
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const operatorId = client.getOperatorId();
  if (!operatorId) {
    throw new Error(
      'operatorId is not configured for config mutations. Set HERMES_OPERATOR_ID (or OPERATOR_TELEGRAM_ID) in the MCP server env.',
    );
  }
  const body: Record<string, unknown> = { operatorId };
  if (args.approveReason !== undefined) body.approveReason = args.approveReason;
  for (const f of fields) {
    if (args[f] !== undefined) body[f] = args[f];
  }
  if (extra) Object.assign(body, extra);
  return body;
}
