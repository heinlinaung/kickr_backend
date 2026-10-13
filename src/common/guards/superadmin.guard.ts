import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Allows only users whose `role` is 'superadmin'.
 *
 * Runs AFTER JwtAuthGuard, which puts the user document on `request.user` —
 * list it second in `@UseGuards(JwtAuthGuard, SuperadminGuard)`.
 */
@Injectable()
export class SuperadminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (user?.role !== 'superadmin') {
      throw new ForbiddenException('Superadmin only');
    }
    return true;
  }
}
