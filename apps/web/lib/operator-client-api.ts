/**
 * Browser-side fetch to the Next.js BFF (`/api/operator/*`), which proxies to
 * Nest services using server env (`*_API_BASE`). Keeps secrets off the client.
 */
export async function fetchOperatorBffJson<T>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const method = init?.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init?.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(`/api/operator${path}`, {
    credentials: 'same-origin',
    method,
    headers,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Operator BFF HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}
