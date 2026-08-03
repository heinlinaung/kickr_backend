import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

export const ADMIN_KEY_HEADER = 'x-admin-key';

/**
 * Shared-secret guard for the server-to-server admin routes.
 *
 * These routes have no acting user, so they do not use JwtAuthGuard. Anyone
 * holding ADMIN_KEY can add any user to any group or event — treat it as a
 * root-level credential.
 */
@Injectable()
export class AdminKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configured = this.config.get<string>('ADMIN_KEY');

    // Fail closed. If the env var is unset or blank the endpoints are disabled
    // outright, rather than silently becoming unauthenticated.
    if (!configured) {
      throw new ForbiddenException('Admin endpoints are disabled');
    }

    const request = context.switchToHttp().getRequest();
    const provided = request.headers?.[ADMIN_KEY_HEADER];

    if (typeof provided !== 'string' || provided.length === 0) {
      throw new UnauthorizedException('Missing admin key');
    }

    if (!safeEqual(provided, configured)) {
      throw new ForbiddenException('Invalid admin key');
    }

    return true;
  }
}

/**
 * Constant-time comparison, so a wrong key cannot be discovered a byte at a
 * time from response timing. timingSafeEqual throws on a length mismatch, so
 * the lengths are compared first — that leaks only the key's length.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
