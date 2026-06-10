import { type McpServerHandle, HermesClient } from './helper.js';
import { registerPlanTools } from './plans.js';
import { registerPositionTools } from './positions.js';
import { registerIncidentTools } from './incidents.js';
import { registerSafeModeTools } from './safe-mode.js';
import { registerAuditTools } from './audit.js';
import { registerDashboardTools } from './dashboard.js';

/**
 * Register all 14 MCP tools on the server.
 */
export function registerTools(server: McpServerHandle, client: HermesClient): void {
  registerPlanTools(server, client);       // list_plans, get_plan, arm_plan, execute_plan
  registerPositionTools(server, client);   // list_positions, close_position
  registerIncidentTools(server, client);   // list_incidents, resolve_incident, list_incident_briefs
  registerSafeModeTools(server, client);   // get_safe_mode_status, enable_safe_mode, disable_safe_mode
  registerAuditTools(server, client);      // get_approvals_queue
  registerDashboardTools(server, client);  // get_dashboard_summary
}