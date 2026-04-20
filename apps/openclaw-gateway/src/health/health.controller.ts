import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  health(): { ok: true; service: string; phase: string } {
    return { ok: true, service: 'openclaw-gateway', phase: '5-gateway-read' };
  }

  /**
   * Optional probe: GET operator BFF summary when OPERATOR_WEB_BFF_BASE is set (server-side).
   */
  @Get('health/operator-bff')
  async operatorBffProbe(): Promise<{
    configured: boolean;
    reachable: boolean | null;
    status: number | null;
  }> {
    const base = process.env.OPERATOR_WEB_BFF_BASE?.replace(/\/$/, '') ?? '';
    if (base.length === 0) {
      return { configured: false, reachable: null, status: null };
    }
    try {
      const url = `${base}/api/operator/dashboard/summary`;
      const res = await fetch(url, { method: 'GET' });
      return {
        configured: true,
        reachable: res.ok,
        status: res.status,
      };
    } catch {
      return { configured: true, reachable: false, status: null };
    }
  }
}
