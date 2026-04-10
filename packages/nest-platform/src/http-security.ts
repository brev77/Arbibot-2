import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

export type ArbibotHttpSecurityEnv = NodeJS.ProcessEnv;

/** Comma-separated list in `CORS_ORIGINS`, e.g. `http://localhost:3000,http://127.0.0.1:3001`. */
export function parseCorsOrigins(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') {
    return [];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const DEV_DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
] as const;

/**
 * Security headers, basic rate limiting, and optional CORS for browser clients.
 * In `NODE_ENV=production`, CORS is enabled only when `CORS_ORIGINS` is non-empty.
 */
export async function applyArbibotHttpSecurity(
  app: NestFastifyApplication,
  env: ArbibotHttpSecurityEnv = process.env,
): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();

  await fastify.register(helmet, {
    global: true,
    contentSecurityPolicy: false,
  });

  const max = Number(env.HTTP_RATE_LIMIT_MAX ?? 300);
  const safeMax = Number.isFinite(max) && max > 0 ? max : 300;

  await fastify.register(rateLimit, {
    max: safeMax,
    timeWindow: env.HTTP_RATE_LIMIT_WINDOW ?? '1 minute',
    allowList: (req) => {
      const pathOnly = req.url.split('?')[0] ?? '';
      return pathOnly === '/metrics';
    },
  });

  const configured = parseCorsOrigins(env.CORS_ORIGINS);
  const isProd = env.NODE_ENV === 'production';

  if (configured.length > 0) {
    app.enableCors({
      origin: configured,
      credentials: true,
    });
  } else if (!isProd) {
    app.enableCors({
      origin: [...DEV_DEFAULT_ORIGINS],
      credentials: true,
    });
  }
}
