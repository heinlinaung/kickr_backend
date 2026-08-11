import {
  HttpException,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * The AWS error name, attached to every mapped exception.
 *
 * The user-facing messages below are deliberately vague — "Invalid credentials"
 * must not reveal whether an account exists. But that vagueness is actively
 * harmful for server-side callers: a throttled `SignUp` returns
 * `NotAuthorizedException`, which then reads as "wrong password" and sends
 * anyone debugging it down the wrong path. Preserving the name costs nothing
 * (it never reaches an HTTP body) and makes the real cause recoverable.
 */
export const COGNITO_ERROR_NAME = Symbol('cognitoErrorName');

/** Reads the original AWS error name off a mapped exception, if present. */
export function cognitoErrorName(err: unknown): string | undefined {
  return (err as Record<symbol, string> | null)?.[COGNITO_ERROR_NAME];
}

/** True when the failure was AWS refusing the call for rate reasons. */
export function isCognitoThrottle(err: unknown): boolean {
  const name = cognitoErrorName(err);
  return (
    name === 'TooManyRequestsException' ||
    name === 'LimitExceededException' ||
    name === 'ThrottlingException'
  );
}

export function mapCognitoError(err: unknown): HttpException {
  const name = (err as { name?: string })?.name ?? '';
  const message = (err as { message?: string })?.message ?? 'Auth error';

  const mapped = ((): HttpException => {
    switch (name) {
      case 'UsernameExistsException':
        return new ConflictException('Username already registered');
      case 'NotAuthorizedException':
        return new UnauthorizedException('Invalid credentials');
      case 'UserNotConfirmedException':
        return new ForbiddenException('Account not confirmed');
      case 'UserNotFoundException':
        return new NotFoundException('User not found');
      case 'CodeMismatchException':
      case 'ExpiredCodeException':
        return new BadRequestException('Invalid or expired code');
      case 'InvalidPasswordException':
      case 'InvalidParameterException':
        return new BadRequestException(message);
      case 'LimitExceededException':
      case 'TooManyRequestsException':
        return new ServiceUnavailableException('Too many attempts, retry later');
      default:
        return new BadRequestException(message);
    }
  })();

  // Symbol key, non-enumerable: invisible to JSON.stringify and to Nest's
  // exception serialisation, so no client-facing response can leak it.
  Object.defineProperty(mapped, COGNITO_ERROR_NAME, {
    value: name,
    enumerable: false,
  });
  return mapped;
}
