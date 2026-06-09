import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';

const HEADER = 'x-hermes-api-key';

function parseAllowedKeys(): string[] {
  const raw = process.env.HERMES_API_KEYS;
  if (raw === undefined || raw.trim().length === 0) {
    return [];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

@Injectable()
export class HermesAuthGuard implements CanActivate {
  private readonly log = new Logger(HermesAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const allowed = parseAllowedKeys();
    if (allowed.length === 0) {
      this.log.warn('HERMES_API_KEYS is empty — rejecting Hermes requests');
      throw new UnauthorizedException(
        'Hermes API is not configured (HERMES_API_KEYS)',
      );
    }

    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const headerVal = req.headers[HEADER];
    const provided =
      typeof headerVal === 'string'
        ? headerVal
        : Array.isArray(headerVal)
          ? headerVal[0]
          : '';

    if (provided === undefined || provided.length === 0) {
      this.log.warn('Missing x-hermes-api-key');
      throw new UnauthorizedException('Missing x-hermes-api-key header');
    }

    if (!allowed.includes(provided)) {
      this.log.warn('Invalid x-hermes-api-key (rejected)');
      throw new UnauthorizedException('Invalid x-hermes-api-key');
    }

    return true;
  }
}
