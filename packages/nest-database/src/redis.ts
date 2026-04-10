import { createClient } from 'redis';

/**
 * Connected Redis client when `REDIS_URL` is set; otherwise `null`.
 * Call `client.quit()` on process shutdown when non-null.
 */
export async function createRedisClientFromEnv(): Promise<
  ReturnType<typeof createClient> | null
> {
  const url = process.env.REDIS_URL;
  if (url === undefined || url.length === 0) {
    return null;
  }
  const client = createClient({ url });
  await client.connect();
  return client;
}
