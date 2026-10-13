import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { SuperadminGuard } from './superadmin.guard';

const ctx = (user: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

describe('SuperadminGuard', () => {
  const guard = new SuperadminGuard();

  it('allows a superadmin', () => {
    expect(guard.canActivate(ctx({ role: 'superadmin' }))).toBe(true);
  });

  it.each([[{ role: 'user' }], [{}], [undefined]])(
    'rejects %p with 403',
    (user) => {
      expect(() => guard.canActivate(ctx(user))).toThrow(ForbiddenException);
    },
  );
});
