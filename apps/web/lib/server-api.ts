export interface ListResponse<TItem> {
  readonly items: TItem[];
}

export type FetchResourceResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: 'not_found' }
  | { ok: false; kind: 'upstream'; status: number }
  | { ok: false; kind: 'network' };

export async function fetchJson<T>(
  url: string,
  revalidateSeconds: number,
): Promise<T | null> {
  try {
    const res = await fetch(url, { next: { revalidate: revalidateSeconds } });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Distinct handling for 404 vs upstream vs network (e.g. opportunity detail). */
export async function fetchResource<T>(
  url: string,
  revalidateSeconds: number,
): Promise<FetchResourceResult<T>> {
  try {
    const res = await fetch(url, { next: { revalidate: revalidateSeconds } });
    if (res.status === 404) {
      return { ok: false, kind: 'not_found' };
    }
    if (!res.ok) {
      return { ok: false, kind: 'upstream', status: res.status };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, kind: 'network' };
  }
}
