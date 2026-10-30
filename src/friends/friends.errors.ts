import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Machine-readable codes for the friends and event-invitation endpoints.
 * Thrown as `{ code, message }` bodies, which HttpExceptionFilter spreads into
 * the response, so a client switches on `code` and shows `message`.
 */
export const FRIEND_ERRORS = {
  CANNOT_FRIEND_SELF: HttpStatus.BAD_REQUEST,
  INVALID_REQUEST: HttpStatus.BAD_REQUEST,
  NOT_FRIENDS: HttpStatus.FORBIDDEN,
  NOT_EVENT_PARTICIPANT: HttpStatus.FORBIDDEN,
  NOT_REQUEST_ADDRESSEE: HttpStatus.FORBIDDEN,
  NOT_REQUEST_OWNER: HttpStatus.FORBIDDEN,
  NOT_INVITATION_OWNER: HttpStatus.FORBIDDEN,
  USER_NOT_FOUND: HttpStatus.NOT_FOUND,
  EVENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  REQUEST_NOT_FOUND: HttpStatus.NOT_FOUND,
  INVITATION_NOT_FOUND: HttpStatus.NOT_FOUND,
  ALREADY_FRIENDS: HttpStatus.CONFLICT,
  REQUEST_ALREADY_EXISTS: HttpStatus.CONFLICT,
  REQUEST_NOT_PENDING: HttpStatus.CONFLICT,
  ALREADY_PARTICIPANT: HttpStatus.CONFLICT,
  INVITATION_EXISTS: HttpStatus.CONFLICT,
  INVITATION_NOT_PENDING: HttpStatus.CONFLICT,
  EVENT_CLOSED: HttpStatus.CONFLICT,
  EVENT_FULL: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
} as const;

export type FriendErrorCode = keyof typeof FRIEND_ERRORS;

export function friendError(
  code: FriendErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): HttpException {
  return new HttpException({ code, message, ...extra }, FRIEND_ERRORS[code]);
}
