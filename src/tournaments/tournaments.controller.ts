import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TournamentsService } from './tournaments.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { RegisterTeamDto } from './dto/register-team.dto';
import { JoinTournamentByCodeDto } from './dto/join-by-code.dto';

@ApiTags('Tournaments')
@ApiBearerAuth()
@Controller('tournaments')
@UseGuards(JwtAuthGuard)
export class TournamentsController {
  constructor(private tournamentsService: TournamentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a tournament',
    description:
      'Creates a tournament with the caller as its organizer (`createdBy`). Only the organizer can later ' +
      'change the format, run draws, record results, etc.\n\n' +
      '- **groupId** (optional): ties the tournament to a group; the caller must be an approved owner or ' +
      'admin of that group, otherwise `403`.\n' +
      '- **format**: `LEAGUE`, `KNOCKOUT` (default) or `LEAGUE_KNOCKOUT`. The deprecated `type` ' +
      '(`league` / `knockout`) is still accepted and maps one to one.\n' +
      '- All phase settings start at their defaults (single round robin, 3/1/0 points, random group draw, ' +
      'top 2 per group qualify, single-leg knockout decided by penalties). Change them with ' +
      '`PUT /tournaments/{id}/format`.\n' +
      '- The new tournament starts in status `REGISTRATION_OPEN` with `currentTeams: 0`.\n\n' +
      'Returns the created tournament document.',
  })
  create(@CurrentUser() user: any, @Body() dto: CreateTournamentDto) {
    return this.tournamentsService.create(user._id.toString(), dto);
  }

  @Post('join-by-code')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Join a tournament from its QR code or share link',
    description:
      'Registers the caller’s team in the tournament behind a scanned QR / opened link ' +
      '(`{APP_BASE_URL}/t/{code}`). Same body and rules as `POST /tournaments/{id}/teams`, plus ' +
      '**code** (case-insensitive). To show the tournament before joining, fetch `GET /t/{code}` ' +
      'with `Accept: application/json`.\n\n' +
      'Errors: `404 INVALID_INVITE_CODE`; `400` "Tournament is not accepting registrations" / ' +
      '"Tournament is full"; `409` when the captain already has a team in this tournament.',
  })
  joinByCode(@CurrentUser() user: any, @Body() dto: JoinTournamentByCodeDto) {
    return this.tournamentsService.joinByCode(user._id.toString(), dto);
  }

  /**
   * Declared BEFORE `@Get(':id')` on purpose — Nest matches routes in
   * declaration order, and `group` would otherwise be swallowed as an `:id`.
   */
  @Get('group/:groupId')
  @ApiOperation({
    summary: "All of one group's tournaments, newest first",
    description:
      'Lists the tournaments tied to a group (created with `groupId`), for the group detail screen.\n\n' +
      '- Public group: any authenticated caller.\n' +
      '- Private group: approved members only, otherwise `403` (a pending join request is not enough).\n' +
      '- **status** (optional) filters by tournament status.\n\n' +
      'Returns an array of tournament documents (no teams or matches; use `GET /tournaments/{id}` for those).\n\n' +
      'Errors: `400` invalid group id or unknown status; `404` group not found.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    example: 'REGISTRATION_OPEN',
    description:
      'Optional filter: DRAFT | REGISTRATION_OPEN | REGISTRATION_CLOSED | LEAGUE_IN_PROGRESS | ' +
      'QUALIFICATION_REVIEW | KNOCKOUT_IN_PROGRESS | COMPLETED | CANCELLED.',
  })
  listByGroup(
    @Param('groupId') groupId: string,
    @CurrentUser() user: any,
    @Query('status') status?: string,
  ) {
    return this.tournamentsService.listByGroup(
      groupId,
      user._id.toString(),
      status,
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a tournament with its teams and matches',
    description:
      'Returns `{ tournament, teams, matches }`:\n\n' +
      '- **tournament**: the tournament document (format, settings, status, `currentTeams` / `maxTeams`, ' +
      'final `placements` once completed).\n' +
      '- **teams**: every registered team, including withdrawn ones (check `status`).\n' +
      '- **matches**: every league and knockout match, unordered. For structured views use ' +
      '`GET /tournaments/{id}/league/groups`, `/standings` and `/bracket`.\n\n' +
      '`404` if the tournament does not exist.',
  })
  findOne(@Param('id') id: string) {
    return this.tournamentsService.findById(id);
  }

  @Get(':id/qr')
  @ApiOperation({
    summary: 'The tournament’s QR code / share link',
    description:
      'Returns `{ inviteCode, inviteLink, deepLink, tournamentId }`. Encode **inviteLink** ' +
      '(`{APP_BASE_URL}/t/{code}`) in the QR: it works from any camera, and its landing page opens ' +
      'the app (`deepLink`, `kickrsport://tournament/{id}`). In the app, join with ' +
      '`POST /tournaments/join-by-code`.\n\n' +
      'Any authenticated user can fetch it (registration is open to everyone anyway). The code is ' +
      'created on the first call and stays the same afterwards.\n\n' +
      'Errors: `404 TOURNAMENT_NOT_FOUND`.',
  })
  getQr(@Param('id') id: string) {
    return this.tournamentsService.getQr(id);
  }

  @Post(':id/teams')
  @ApiOperation({
    summary: 'Register a team in the tournament',
    description:
      'Adds a team while the tournament is `REGISTRATION_OPEN`. Any authenticated user can register.\n\n' +
      '- **captainId** defaults to the caller. A captain can register only one team per tournament ' +
      '(`409 Conflict` otherwise).\n' +
      '- **players**: user ids of the squad.\n' +
      '- **clubId** (optional): the group (club) the team belongs to; used by the group draw to keep ' +
      'club-mates apart when `separateSameClub` is on.\n' +
      '- The slot is reserved atomically, so `currentTeams` never exceeds `maxTeams`.\n' +
      '- New teams are `APPROVED` and take part in the next draw or bracket.\n\n' +
      'Errors: `404` tournament not found; `400` "Tournament is not accepting registrations" when the ' +
      'status is not `REGISTRATION_OPEN`, or "Tournament is full".',
  })
  registerTeam(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: RegisterTeamDto,
  ) {
    return this.tournamentsService.registerTeam(id, user._id.toString(), dto);
  }
}
