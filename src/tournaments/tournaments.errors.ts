import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Machine-readable codes for the tournament format and phase endpoints.
 * Thrown as `{ code, message }` bodies, which HttpExceptionFilter spreads into
 * the response, so a client switches on `code` and shows `message`.
 */
export const TOURNAMENT_ERRORS = {
  INVALID_FORMAT_SETTINGS: HttpStatus.BAD_REQUEST,
  INVALID_REQUEST: HttpStatus.BAD_REQUEST,
  KNOCKOUT_NEEDS_WINNER: HttpStatus.BAD_REQUEST,
  PENALTIES_NOT_ALLOWED: HttpStatus.BAD_REQUEST,
  NOT_ORGANIZER: HttpStatus.FORBIDDEN,
  TOURNAMENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  TEAM_NOT_FOUND: HttpStatus.NOT_FOUND,
  MATCH_NOT_FOUND: HttpStatus.NOT_FOUND,
  GROUP_NOT_FOUND: HttpStatus.NOT_FOUND,
  FORMAT_LOCKED: HttpStatus.CONFLICT,
  NOT_ENOUGH_TEAMS: HttpStatus.CONFLICT,
  DRAW_NOT_DONE: HttpStatus.CONFLICT,
  PHASE_NOT_READY: HttpStatus.CONFLICT,
  UNRESOLVED_TIE: HttpStatus.CONFLICT,
  RESULT_LOCKED: HttpStatus.CONFLICT,
  MATCH_NOT_READY: HttpStatus.CONFLICT,
  INVALID_STATUS_TRANSITION: HttpStatus.CONFLICT,
  // Invitations
  NOT_GROUP_ADMIN: HttpStatus.FORBIDDEN,
  INVITATION_NOT_FOUND: HttpStatus.NOT_FOUND,
  INVITATION_EXISTS: HttpStatus.CONFLICT,
  INVITATION_NOT_PENDING: HttpStatus.CONFLICT,
  ALREADY_REGISTERED: HttpStatus.CONFLICT,
  TOURNAMENT_CLOSED: HttpStatus.CONFLICT,
  TOURNAMENT_FULL: HttpStatus.CONFLICT,
  // QR / share link
  INVALID_INVITE_CODE: HttpStatus.NOT_FOUND,
} as const;

export type TournamentErrorCode = keyof typeof TOURNAMENT_ERRORS;

export function tournamentError(
  code: TournamentErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): HttpException {
  return new HttpException(
    { code, message, ...extra },
    TOURNAMENT_ERRORS[code],
  );
}
