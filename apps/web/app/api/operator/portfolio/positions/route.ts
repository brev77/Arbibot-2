import { apiBases } from '@/lib/api-base';
import { proxyUpstream } from '@/lib/operator-bff-proxy';

export async function GET(): Promise<Response> {
  return proxyUpstream(`${apiBases.portfolio}/positions`);
}
