import { apiBases } from '@/lib/api-base';
import { proxyUpstream } from '@/lib/operator-bff-proxy';

export async function POST(): Promise<Response> {
  return proxyUpstream(`${apiBases.reconciliation}/mismatches/run-detectors`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
}
