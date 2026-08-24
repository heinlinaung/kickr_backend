import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Pulls the raw bearer token out of a request's Authorization header.
 *
 * Exported separately from the decorator below because a `createParamDecorator`
 * factory is only reachable through Nest's request pipeline — testing it via the
 * decorator would mean reimplementing this logic in the spec, which then passes
 * whether or not the real thing works.
 */
export function extractBearerToken(req: unknown): string {
  const header: unknown = (req as { headers?: Record<string, unknown> })
    ?.headers?.['authorization'];
  if (typeof header !== 'string') {
    throw new UnauthorizedException('Missing bearer token');
  }
  // Case-insensitive scheme: RFC 7235 says the scheme is not case-sensitive,
  // and real clients send both "Bearer" and "bearer".
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new UnauthorizedException('Missing bearer token');
  }
  return token;
}

/**
 * The raw bearer token from the Authorization header.
 *
 * `@CurrentUser()` gives the resolved Mongo user, which is what almost every
 * route wants. This gives the undecoded token string, which a handful of Cognito
 * calls need as a credential in their own right — `ChangePassword` authenticates
 * by access token rather than by client secret, so the verified claims are not
 * enough; AWS needs the original string back.
 *
 * Only meaningful behind `JwtAuthGuard`. The guard has already verified the
 * signature by the time this runs, so reaching the `throw` means the route was
 * left unguarded — a wiring mistake, surfaced as a 401 rather than passing
 * `undefined` down to AWS as a confusing "invalid token".
 */
export const AccessToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    extractBearerToken(ctx.switchToHttp().getRequest()),
);
