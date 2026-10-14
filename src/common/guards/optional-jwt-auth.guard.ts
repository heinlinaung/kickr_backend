import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT auth that never rejects: a valid token attaches the user, anything
 * else (no header, expired, garbage) leaves `request.user` null and lets
 * the request through.
 *
 * For PUBLIC endpoints whose response still carries caller-specific flags —
 * the group/event detail pages, where `userRole`, `isCashier`, `joinedByMe`
 * and friends should light up for a signed-in caller but the data itself is
 * open to everyone.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(_err: unknown, user: TUser): TUser | null {
    return user || null;
  }
}
