import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

import { OpenclawRateLimitService } from './openclaw-rate-limit.service';

const HEADER = 'x-openclaw-api-key';

@Injectable()
export class OpenclawMutationRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: OpenclawRateLimitService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const headerVal = req.headers[HEADER];
    const raw =
      typeof headerVal === 'string'
        ? headerVal
        : Array.isArray(headerVal)
          ? headerVal[0]
          : '';
    const key = raw ?? '';
    const bucketKey = key.length > 0 ? key : 'anonymous';
    if (!this.limiter.allow(bucketKey)) {
      throw new HttpException(
        'OpenClaw mutation rate limit exceeded; retry later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
