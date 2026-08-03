import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AdminKeyGuard, ADMIN_KEY_HEADER } from './admin-key.guard';

const ctx = (headers: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  }) as any;

const guardWith = (adminKey: string | undefined) =>
  new AdminKeyGuard({ get: () => adminKey } as any);

describe('AdminKeyGuard', () => {
  it('allows a request carrying the correct key', () => {
    const guard = guardWith('s3cret-key');
    expect(guard.canActivate(ctx({ [ADMIN_KEY_HEADER]: 's3cret-key' }))).toBe(
      true,
    );
  });

  it('401s when the header is missing', () => {
    const guard = guardWith('s3cret-key');
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
  });

  it('401s when the header is empty', () => {
    const guard = guardWith('s3cret-key');
    expect(() => guard.canActivate(ctx({ [ADMIN_KEY_HEADER]: '' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('403s when the key is wrong', () => {
    const guard = guardWith('s3cret-key');
    expect(() =>
      guard.canActivate(ctx({ [ADMIN_KEY_HEADER]: 'wrong-key' })),
    ).toThrow(ForbiddenException);
  });

  it('403s on a wrong key of a different length (no timingSafeEqual throw)', () => {
    const guard = guardWith('s3cret-key');
    // timingSafeEqual throws on length mismatch, so the guard must length-check
    // first — otherwise this surfaces as a 500 rather than a 403.
    expect(() =>
      guard.canActivate(ctx({ [ADMIN_KEY_HEADER]: 'short' })),
    ).toThrow(ForbiddenException);
  });

  // Fail closed: an unset key must not make the endpoints public.
  it('rejects everything when ADMIN_KEY is unset', () => {
    const guard = guardWith(undefined);
    expect(() =>
      guard.canActivate(ctx({ [ADMIN_KEY_HEADER]: 'anything' })),
    ).toThrow(ForbiddenException);
  });

  it('rejects everything when ADMIN_KEY is blank', () => {
    const guard = guardWith('');
    expect(() => guard.canActivate(ctx({ [ADMIN_KEY_HEADER]: '' }))).toThrow(
      ForbiddenException,
    );
  });
});
