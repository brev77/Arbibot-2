export interface ListResponse<TItem> {
  readonly items: TItem[];
}

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
