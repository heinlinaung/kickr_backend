// src/awards/awards.errors.ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';

/**
 * Machine-readable codes for the awards endpoints. Thrown as
 * `{ code, message }` bodies, which HttpExceptionFilter spreads into the
 * response, so a client switches on `code` and shows `message`.
 */
export const AWARD_ERRORS = {
  NOT_EVENT_ORGANIZER: ForbiddenException,
  USER_NOT_IN_EVENT: BadRequestException,
  MVP_ALREADY_AWARDED: ConflictException,
  EVENT_NOT_FINISHED: BadRequestException,
  AWARD_NOT_FOUND: NotFoundException,
  NOT_ELIGIBLE_FOR_MEMORY: ForbiddenException,
  MEMORY_EXISTS: ConflictException,
  MEMORY_NOT_FOUND: NotFoundException,
  NOT_GROUP_MEMBER: ForbiddenException,
} as const;

export type AwardErrorCode = keyof typeof AWARD_ERRORS;

export function awardError(
  code: AwardErrorCode,
  message: string,
): HttpException {
  return new AWARD_ERRORS[code]({ code, message });
}
