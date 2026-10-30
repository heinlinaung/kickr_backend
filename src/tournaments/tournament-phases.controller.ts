import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TournamentPhasesService } from './tournament-phases.service';
import { SetFormatDto } from './dto/set-format.dto';
import { LeagueDrawDto } from './dto/league-draw.dto';
import { ResolveTieDto } from './dto/resolve-tie.dto';
import { KnockoutBracketDto } from './dto/knockout-bracket.dto';
import { UpdateTournamentStatusDto } from './dto/update-tournament-status.dto';

/**
 * Format, league and knockout phases of a tournament. Writes need the
 * organizer (`403 NOT_ORGANIZER`); standings, groups, qualification and the
 * bracket are readable by anyone who can see the tournament.
 */
@ApiTags('Tournaments')
@ApiBearerAuth()
@Controller('tournaments/:id')
@UseGuards(JwtAuthGuard)
export class TournamentPhasesController {
  constructor(private readonly phases: TournamentPhasesService) {}

  @Put('format')
  @ApiOperation({
    summary: 'Set format and all phase settings',
    description:
      'Chooses the format (`LEAGUE`, `KNOCKOUT`, `LEAGUE_KNOCKOUT`) and its `league`, `qualification` and ' +
      '`knockout` settings. Omitted settings fall back to their defaults; settings a format does not use ' +
      'are dropped. Organizer only.\n\n' +
      '**When it can change**\n' +
      '- `DRAFT` / `REGISTRATION_OPEN` / `REGISTRATION_CLOSED`: freely. Any existing draw, fixtures or ' +
      'bracket are deleted (`drawReset: true` in the response).\n' +
      '- `LEAGUE_IN_PROGRESS`: only with `confirm: true` and no league results yet. Everything is rebuilt ' +
      'and the tournament goes back to `REGISTRATION_CLOSED`.\n' +
      '- `QUALIFICATION_REVIEW`: only qualification seeding and knockout settings may change; qualifiers ' +
      'and the proposed bracket are recomputed.\n' +
      '- `KNOCKOUT_IN_PROGRESS`: knockout settings only, with `confirm: true` and no knockout results; the ' +
      'bracket is deleted and the tournament steps back to `QUALIFICATION_REVIEW` (or ' +
      '`REGISTRATION_CLOSED` for knockout-only).\n' +
      '- Otherwise `409 FORMAT_LOCKED`.\n\n' +
      'Settings are validated against the team count (approved teams, or `maxTeams` while fewer than 2 ' +
      'are approved): `400 INVALID_FORMAT_SETTINGS`.\n\n' +
      '**Response**: the saved format and settings, the resulting `status`, `drawReset`, a `preview` ' +
      '(team count, group sizes, matches per phase, number of qualifiers, bracket size / starting round) ' +
      'and `suggestions` (recommended league+knockout setups for this team count).',
  })
  setFormat(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: SetFormatDto,
  ) {
    return this.phases.setFormat(id, user._id.toString(), dto);
  }

  @Patch('status')
  @ApiOperation({
    summary: 'Open or close registration, or cancel',
    description:
      'Moves the tournament between the organizer-controlled statuses. Organizer only.\n\n' +
      '**Allowed transitions**\n' +
      '- `DRAFT` → `REGISTRATION_OPEN`\n' +
      '- `REGISTRATION_OPEN` → `DRAFT` or `REGISTRATION_CLOSED`\n' +
      '- `REGISTRATION_CLOSED` → `REGISTRATION_OPEN` (reopening deletes the draw, fixtures and bracket, ' +
      'since new teams may join; `drawReset: true`)\n' +
      '- any unfinished status → `CANCELLED`\n\n' +
      'Phase statuses (`LEAGUE_IN_PROGRESS`, `QUALIFICATION_REVIEW`, `KNOCKOUT_IN_PROGRESS`, `COMPLETED`) ' +
      'are reached through the phase endpoints, not set here. Setting the current status again is a no-op.\n\n' +
      'Errors: `409 INVALID_STATUS_TRANSITION`.\n\n' +
      'Returns `{ status, drawReset }`.',
  })
  setStatus(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateTournamentStatusDto,
  ) {
    return this.phases.setStatus(id, user._id.toString(), dto);
  }

  @Post('teams/:teamId/withdraw')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Withdraw a team',
    description:
      'Marks a team `WITHDRAWN`. Organizer only. What happens to its matches depends on the stage:\n\n' +
      '- **Before the league / knockout starts**: its slot is freed (`currentTeams - 1`) and any draw, ' +
      'fixtures and bracket are deleted so they can be redone (`drawReset: true`).\n' +
      '- **During the league**: if it has played under half its matches, all its results are voided and it ' +
      'leaves the table; otherwise its remaining matches are recorded as 3–0 wins for its opponents. ' +
      'Standings are recalculated and the league may finish as a result.\n' +
      '- **During qualification review**: qualification is recomputed, so the next-ranked team in its ' +
      'group takes its place.\n' +
      '- **During the knockout**: its opponent wins by walkover as soon as their match has both teams.\n\n' +
      'Withdrawing an already withdrawn team is a no-op. Errors: `404 TEAM_NOT_FOUND`; ' +
      '`409 INVALID_STATUS_TRANSITION` once the tournament is `COMPLETED` or `CANCELLED`.\n\n' +
      'Returns `{ team, drawReset }`.',
  })
  withdraw(
    @Param('id') id: string,
    @Param('teamId') teamId: string,
    @CurrentUser() user: any,
  ) {
    return this.phases.withdrawTeam(id, teamId, user._id.toString());
  }

  @Post('league/draw')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Put teams into groups (random, seeded, manual)',
    description:
      'Splits the approved teams into `league.groupCount` groups. Organizer only; `LEAGUE` and ' +
      '`LEAGUE_KNOCKOUT` formats, before the league starts.\n\n' +
      "**Methods** (`method`, default: the format's `groupDraw`)\n" +
      '- `RANDOM`: shuffled evenly across groups.\n' +
      '- `SEEDED`: `pots` lists team ids per pot, strongest first; each group gets one team per pot. Every ' +
      'approved team must appear exactly once and a pot holds at most `groupCount` teams.\n' +
      '- `MANUAL`: `groups` lists team ids per group, group A first; exactly `groupCount` entries covering ' +
      'every approved team once.\n\n' +
      '`separateSameClub` (default: the format setting) keeps teams with the same `clubId` in different ' +
      'groups where possible (RANDOM / SEEDED).\n\n' +
      '**Effects**: replaces any earlier draw, fixtures and bracket, and closes registration ' +
      '(`REGISTRATION_CLOSED`). Groups are named A, B, C… (or "League" with one group). Run ' +
      '`POST league/fixtures` next.\n\n' +
      'Errors: `NOT_ENOUGH_TEAMS` (fewer than 2 teams per group), `INVALID_FORMAT_SETTINGS` (no league ' +
      "phase, or teams don't fit `teamsPerGroup`), `INVALID_REQUEST` (bad pots / groups), `FORMAT_LOCKED` " +
      '(league already started).\n\n' +
      'Returns the same body as `GET league/groups`.',
  })
  draw(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: LeagueDrawDto,
  ) {
    return this.phases.draw(id, user._id.toString(), dto);
  }

  @Get('league/groups')
  @ApiOperation({
    summary: 'Groups and their teams',
    description:
      'Returns `{ drawn, groups }`. `drawn` is false until the group draw has run. Each group has `id`, ' +
      '`name` and `teams` in draw order; each team has `teamId`, `name`, `withdrawn`, `pot` (SEEDED draws, ' +
      'otherwise null) and `drawOrder`.',
  })
  groups(@Param('id') id: string) {
    return this.phases.getGroups(id);
  }

  @Post('league/fixtures')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Generate round-robin fixtures',
    description:
      'Creates every league match for the drawn groups. Organizer only; needs the group draw first ' +
      '(`409 DRAW_NOT_DONE`) and the league not started (`FORMAT_LOCKED`).\n\n' +
      '- Each group plays a round robin using the circle method: once (`SINGLE`) or home and away ' +
      '(`DOUBLE`), per `league.roundRobin`.\n' +
      '- Matches get a `matchday` and a global `sequence`, ordered so no team plays twice in a row when ' +
      'avoidable.\n' +
      '- Regenerating replaces all existing league fixtures.\n\n' +
      'Returns the list of league matches in play order. Start the league with `POST phases/league/start`.',
  })
  fixtures(@Param('id') id: string, @CurrentUser() user: any) {
    return this.phases.generateFixtures(id, user._id.toString());
  }

  @Post('phases/:phase/start')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Start the league or knockout phase',
    description:
      'Starts a phase so results can be recorded. Organizer only. A phase can be started once ' +
      '(`PHASE_NOT_READY` if already started).\n\n' +
      '**league** → `LEAGUE_IN_PROGRESS`. Needs the tournament not yet started, the group draw ' +
      '(`DRAW_NOT_DONE`) and the fixtures (`PHASE_NOT_READY`).\n\n' +
      '**knockout** → `KNOCKOUT_IN_PROGRESS`.\n' +
      '- `LEAGUE_KNOCKOUT`: the league must be finished (`QUALIFICATION_REVIEW`), every qualification tie ' +
      'resolved (`UNRESOLVED_TIE`, with `ties` in the body) and the bracket confirmed (`PHASE_NOT_READY`). ' +
      'League results lock from now on.\n' +
      '- `KNOCKOUT`: the bracket must be generated; starting confirms it.\n\n' +
      '`INVALID_FORMAT_SETTINGS` if the format has no such phase.\n\n' +
      'Returns `{ status, phase }`.',
  })
  @ApiParam({ name: 'phase', enum: ['league', 'knockout'] })
  start(
    @Param('id') id: string,
    @Param('phase') phase: string,
    @CurrentUser() user: any,
  ) {
    return this.phases.startPhase(id, user._id.toString(), phase);
  }

  @Get('standings')
  @ApiOperation({
    summary: 'League standings, all groups or one',
    description:
      "Returns `{ groups: [{ id, name, standings }] }` with each group's table ranked by points, then the " +
      'configured `tiebreakers` in order (default: head-to-head points, head-to-head goal difference, goal ' +
      'difference, goals for, fair play, lots), then any organizer tie ruling.\n\n' +
      'Each row has `teamId`, `name`, `withdrawn`, `rank`, `played`, `won`, `drawn`, `lost`, `goalsFor`, ' +
      '`goalsAgainst`, `goalDiff`, `points`, `fairPlay` (card points) and `tied` (level after every ' +
      'tiebreaker). Only completed, non-voided matches count. A withdrawn team ' +
      'whose results were all voided is left out.\n\n' +
      'Filter one group with `?group=A` (case-insensitive; `404 GROUP_NOT_FOUND` if unknown). Empty ' +
      '`groups` before the draw.',
  })
  @ApiQuery({ name: 'group', required: false, example: 'A' })
  standings(@Param('id') id: string, @Query('group') group?: string) {
    return this.phases.getStandings(id, group);
  }

  @Get('qualification')
  @ApiOperation({
    summary: 'Who qualified and the proposed bracket',
    description:
      'Only for formats with a league phase (`INVALID_FORMAT_SETTINGS` otherwise). While the league is ' +
      'unfinished returns `{ status: "PENDING", qualifiers: [], ties: [], bracket: null }`.\n\n' +
      '**LEAGUE_KNOCKOUT** → `{ status, qualifiers, ties, bracket }`\n' +
      '- `qualifiers`: the top `qualifyPerGroup` per group plus `bestOfRest` best runners-up, sorted by ' +
      'seed, with `seedLabel` (e.g. "A1"), group, rank, tier and any tie ruling (`resolvedBy`, `reason`).\n' +
      '- `ties`: ties no tiebreaker could separate that affect who qualifies or the seeding; resolve them ' +
      'with `POST qualification/resolve`.\n' +
      '- `bracket`: same shape as `GET bracket` (proposed automatically once no ties are open, unless ' +
      'seeding is `MANUAL`).\n' +
      '- `status`: `TIE_UNRESOLVED`, `REVIEW` (bracket proposed, awaiting confirmation) or `CONFIRMED`.\n\n' +
      '**LEAGUE** → `{ status, placements, ties, bracket: null }`: final places 1–3, or `TIE_UNRESOLVED` ' +
      'with the tie blocking them; otherwise `COMPLETED`.',
  })
  qualification(@Param('id') id: string) {
    return this.phases.getQualification(id);
  }

  @Post('qualification/resolve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Break a tie no tiebreaker could',
    description:
      "Records the organizer's ruling for one open tie (e.g. after drawing lots). Organizer only.\n\n" +
      '- `order`: exactly the team ids of one open tie from `GET qualification`, best first ' +
      '(`INVALID_REQUEST` with the open `ties` otherwise).\n' +
      '- `reason`: why / how it was decided; stored with the ruling and shown on the qualifiers.\n\n' +
      'Allowed once the league has finished (`PHASE_NOT_READY`) and while in `QUALIFICATION_REVIEW` ' +
      '(league-only: before completion) — `FORMAT_LOCKED` otherwise.\n\n' +
      '**Effects**: standings, qualifiers and the proposed bracket are recomputed; for league-only ' +
      'tournaments this can complete the tournament.\n\n' +
      'Returns the same body as `GET qualification`.',
  })
  resolve(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: ResolveTieDto,
  ) {
    return this.phases.resolveTie(id, user._id.toString(), dto);
  }

  @Post('knockout/bracket')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Generate or confirm the bracket',
    description:
      'Builds the knockout bracket, or confirms it. Organizer only; not for `LEAGUE` tournaments ' +
      '(`INVALID_FORMAT_SETTINGS`) and only before the knockout starts (`FORMAT_LOCKED`).\n\n' +
      '**Body**\n' +
      '- `{}`: (re)generate from the seeding. Knockout-only uses `knockout.bracketSeeding` ' +
      '(`RANDOM_DRAW`); league+knockout uses `qualification.seeding` (`CROSS_GROUP` keeps group-mates ' +
      'apart, `RANKED`, `RANDOM_DRAW`). `MANUAL` seeding requires `order`.\n' +
      '- `{ order }`: lay out round one by hand — one team id per position, `null` for a bye; positions ' +
      '(0,1), (2,3)… are the first-round matches. Must have exactly the bracket size (team count rounded up ' +
      'to a power of two), list every team once, and never pair two byes.\n' +
      '- `{ confirm: true }`: confirm the existing bracket (generates one first if none). Can be combined ' +
      'with `order`.\n\n' +
      'The bracket is padded to the next power of two with byes; bye winners go straight to round two. ' +
      'Two-legged ties (`legs: 2`) get a second leg except the final; a third-place match is added when ' +
      'enabled.\n\n' +
      '**Requirements**\n' +
      '- `KNOCKOUT`: at least 2 approved teams (`NOT_ENOUGH_TEAMS`), before the knockout starts; closes ' +
      'registration.\n' +
      '- `LEAGUE_KNOCKOUT`: tournament in `QUALIFICATION_REVIEW` (`PHASE_NOT_READY`) with no open ties ' +
      '(`UNRESOLVED_TIE`); built from the qualifiers.\n\n' +
      'Returns the same body as `GET bracket`.',
  })
  bracket(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: KnockoutBracketDto,
  ) {
    return this.phases.knockoutBracket(id, user._id.toString(), dto);
  }

  @Get('bracket')
  @ApiOperation({
    summary: 'The bracket, round by round',
    description:
      'Returns `{ confirmed, clashes, rounds, thirdPlace }`.\n\n' +
      '- `confirmed`: whether the organizer confirmed the bracket.\n' +
      '- `clashes`: first-round match indexes where CROSS_GROUP seeding could not avoid two teams from ' +
      'the same group.\n' +
      '- `rounds`: in order (e.g. Round of 16, Quarter-final, Semi-final, Final), each `{ id, name, matches }`.\n' +
      '- `thirdPlace`: the third-place match, or null.\n\n' +
      'Each match: `id`, `slot`, `home` / `away` (`{ teamId, name, withdrawn, seed }` or null while still ' +
      'to be decided; a bye shows as `away: { bye: true }`), `score` (`{ home, away, penalties?, forfeit? }` ' +
      'or null), `status`, `winnerTeamId` and `winnerTo` (`<matchId>.home|away`, where the winner goes ' +
      "next). Two-legged ties add `legs` with each leg's score, and `score` is the aggregate from the " +
      "leg-1 home team's side. Use the match / leg `id` with `PATCH /matches/{matchId}/result`.\n\n" +
      'Empty `rounds` before a bracket exists.',
  })
  getBracket(@Param('id') id: string) {
    return this.phases.getBracket(id);
  }
}
