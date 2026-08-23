import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiQuery,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { multerMemoryImageOptions } from '../common/upload/multer-memory.config';
import { EventsService } from './events.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { UpdateEventStatusDto } from './dto/update-event-status.dto';
import { GenerateTeamsDto } from './dto/generate-teams.dto';
import { AssignTeamPlayersDto } from './dto/assign-team-players.dto';
import { AddMatchDto } from './dto/add-match.dto';
import { UpdateMatchScoreDto } from './dto/update-match-score.dto';
import { SubmitResultDto } from './dto/submit-result.dto';

@ApiTags('Events')
@ApiBearerAuth()
@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private eventsService: EventsService) {}

  @Get()
  @ApiQuery({
    name: 'region',
    required: false,
    example: 'Myanmar',
    description:
      "Filters by the owning group's country OR city. Group values are " +
      'stored lowercase and the input is lowercased before matching, so ' +
      'casing does not matter. Exact whole-value match, not a substring. ' +
      'Events with no group are excluded when set.',
  })
  @ApiQuery({
    name: 'near',
    required: false,
    example: '16.8409,96.1735',
    description: "Latitude,longitude. Pairs with `radius`.",
  })
  @ApiQuery({
    name: 'radius',
    required: false,
    example: 10000,
    description: 'Search radius in metres around `near`. Defaults to 10000.',
  })
  @ApiQuery({ name: 'from', required: false, example: '2026-08-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-08-31' })
  @ApiQuery({ name: 'status', required: false, example: 'join' })
  list(
    @CurrentUser() user: any,
    @Query('region') region?: string,
    @Query('near') near?: string,
    @Query('radius') radius?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('status') status?: string,
  ) {
    return this.eventsService.list(user._id.toString(), {
      region,
      near,
      radius: radius === undefined ? undefined : Number(radius),
      from,
      to,
      status,
    });
  }

  /**
   * Declared BEFORE `@Get(':id')` — same reason as `joined` below: a bare
   * `search` would otherwise be matched as an event id and 404.
   */
  @Get('search')
  @ApiOperation({
    summary: 'Free-text search over public events',
    description:
      'Case-insensitive substring match on title and description, soonest ' +
      'first. Public events only — a private group event never surfaces ' +
      'here, even to a member; use GET /events/group/:groupId for those. ' +
      'Expired and `done` events are hidden unless includeExpired=true. ' +
      'An empty query returns [].',
  })
  @ApiQuery({ name: 'q', required: true, example: 'friday night' })
  @ApiQuery({
    name: 'includeExpired',
    required: false,
    example: false,
    description: 'Include past and `done` events. Defaults to false.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: 'Max results, 1-50. Defaults to 20.',
  })
  searchEvents(
    @Query('q') q?: string,
    @Query('includeExpired') includeExpired?: string,
    @Query('limit') limit?: string,
  ) {
    return this.eventsService.search(
      q ?? '',
      includeExpired === 'true',
      limit === undefined ? undefined : Number(limit),
    );
  }

  /**
   * Declared BEFORE `@Get(':id')` on purpose — Nest matches routes in
   * declaration order, and `joined` would otherwise be swallowed as an `:id`
   * (yielding a 404 for a malformed ObjectId rather than this list).
   *
   * Named for the RELATIONSHIP, not possession: a user also *owns* events they
   * created, so `/events/mine` read as "events I created" — the opposite of
   * what this returns. It also leaves `/events/created` free for that.
   */
  @Get('joined')
  @ApiOperation({
    summary: 'Events the caller has joined, soonest first',
    description:
      'Every event where the caller is on the roster — including private ' +
      'group events, which GET /events cannot show. Expired and `done` ' +
      'events are hidden unless includeExpired=true. An event you have left ' +
      'is excluded.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    example: 'join',
    description: 'Optional lifecycle filter.',
  })
  @ApiQuery({
    name: 'includeExpired',
    required: false,
    example: false,
    description:
      'Expired events (date before today) and `done` events are hidden by ' +
      'default. Set true for the history view.',
  })
  listJoined(
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('includeExpired') includeExpired?: string,
  ) {
    return this.eventsService.listJoined(
      user._id.toString(),
      status,
      includeExpired === 'true',
    );
  }

  /**
   * Declared BEFORE `@Get(':id')` on purpose — Nest matches routes in
   * declaration order, and `group` would otherwise be swallowed as an `:id`.
   */
  @Get('group/:groupId')
  @ApiOperation({
    summary: "All of one group's events, soonest first",
    description:
      'Approved members see every event in the group, public or private. ' +
      'Everyone else sees only the public ones. Expired and `done` events are ' +
      'excluded unless includeExpired=true. Optionally filter by lifecycle ' +
      'status.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    example: 'join',
    description:
      'Optional lifecycle filter: join | preparation | playing | ' +
      'after_match | done.',
  })
  @ApiQuery({
    name: 'includeExpired',
    required: false,
    example: false,
    description:
      'Expired events (date before today) and `done` events are hidden by ' +
      'default. Set true for the history view.',
  })
  @ApiResponse({ status: 404, description: 'Group not found' })
  listByGroup(
    @Param('groupId') groupId: string,
    @CurrentUser() user: any,
    @Query('status') status?: string,
    @Query('includeExpired') includeExpired?: string,
  ) {
    return this.eventsService.listByGroup(
      groupId,
      user._id.toString(),
      status,
      includeExpired === 'true',
    );
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateEventDto) {
    return this.eventsService.create(user._id.toString(), dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.findById(id, user._id.toString());
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit an event (organizer only, not once done)' })
  @ApiResponse({ status: 403, description: 'Caller is not the organizer' })
  @ApiResponse({ status: 400, description: 'Event is already done' })
  update(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateEventDto,
  ) {
    return this.eventsService.update(id, user._id.toString(), dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an event (organizer only, not once done)' })
  @ApiResponse({ status: 403, description: 'Caller is not the organizer' })
  remove(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.remove(id, user._id.toString());
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Advance the event lifecycle',
    description:
      'join -> preparation -> playing -> after_match -> done. ' +
      'preparation may revert to join, reopening registration. ' +
      'done is terminal.',
  })
  @ApiResponse({ status: 409, description: 'Illegal transition' })
  @ApiResponse({ status: 403, description: 'Caller is not the organizer' })
  setStatus(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateEventStatusDto,
  ) {
    return this.eventsService.setStatus(id, user._id.toString(), dto.status);
  }

  @Post(':id/join')
  join(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.join(id, user._id.toString());
  }

  @Delete(':id/join')
  leave(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.leave(id, user._id.toString());
  }

  @Get(':id/players')
  players(@Param('id') id: string) {
    return this.eventsService.listPlayers(id);
  }

  // --- Teams & fixtures (spec §4.3) ---------------------------------------

  @Post(':id/teams/generate')
  @ApiOperation({
    summary: 'Create the teams and the fixture list (organizer, preparation)',
    description:
      'Creates `teamsCount` EMPTY teams named from the colour vocabulary, and ' +
      'derives the match list from the event duration: ' +
      'floor((event.duration - 10) / duration) matches, so the schedule can ' +
      'never overrun the booked slot. Ten minutes are reserved as buffer. ' +
      'Assign players afterwards with PATCH /events/:id/teams/:teamId. ' +
      'Re-running replaces the previous teams and fixtures.',
  })
  @ApiResponse({
    status: 400,
    description: 'Match duration does not fit the event, or wrong state',
  })
  @ApiResponse({ status: 403, description: 'Caller is not the organizer' })
  generateTeams(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: GenerateTeamsDto,
  ) {
    return this.eventsService.generateTeams(id, user._id.toString(), dto);
  }

  @Get(':id/teams')
  @ApiOperation({ summary: "The event's teams, with players populated" })
  teams(@Param('id') id: string) {
    return this.eventsService.listTeams(id);
  }

  @Patch(':id/teams/:teamId')
  @ApiOperation({
    summary: 'Assign or re-assign one team’s roster (organizer, preparation)',
    description:
      'Replaces the team’s players outright — the client shuffles locally and ' +
      'the organizer may hand-edit. Every id must be a joined player, and a ' +
      'player already in another team is refused by name. Optionally renames ' +
      'the team in the same call.',
  })
  @ApiResponse({ status: 400, description: 'Invalid roster, or wrong state' })
  @ApiResponse({ status: 404, description: 'No such team on this event' })
  assignTeamPlayers(
    @Param('id') id: string,
    @Param('teamId') teamId: string,
    @CurrentUser() user: any,
    @Body() dto: AssignTeamPlayersDto,
  ) {
    return this.eventsService.assignTeamPlayers(
      id,
      teamId,
      user._id.toString(),
      dto,
    );
  }

  @Post(':id/matches')
  @ApiOperation({
    summary: 'Add one fixture by hand (organizer only)',
    description:
      'An escape hatch for schedules the generator cannot express — e.g. 3 ' +
      'teams in a 60-minute event fits only one match, leaving a team with no ' +
      'fixture. Appends a single match; does NOT renumber, check the double ' +
      'round-robin, or check the duration budget. Both team names must belong ' +
      'to this event. Created unplayed — score it via PATCH as usual. ' +
      'NOTE: a later /teams/generate or /shuffle replaces the whole fixture ' +
      'list, so add after generating, not before.',
  })
  @ApiResponse({
    status: 400,
    description: 'Unknown team name, a team against itself, or no teams yet',
  })
  @ApiResponse({ status: 403, description: 'Caller is not the organizer' })
  addMatch(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: AddMatchDto,
  ) {
    return this.eventsService.addMatch(id, user._id.toString(), dto);
  }

  @Get(':id/matches')
  @ApiOperation({ summary: 'Fixture list, in match order' })
  matches(@Param('id') id: string) {
    return this.eventsService.listMatches(id);
  }

  @Patch(':id/matches/:matchNumber')
  @ApiOperation({
    summary: 'Enter or correct one fixture score',
    description:
      'Allowed while playing and after_match, so a typo can still be fixed ' +
      'after the whistle. Both scores are required; 0 is a real scoreline.',
  })
  @ApiResponse({ status: 404, description: 'No such fixture number' })
  setMatchScore(
    @Param('id') id: string,
    @Param('matchNumber', ParseIntPipe) matchNumber: number,
    @CurrentUser() user: any,
    @Body() dto: UpdateMatchScoreDto,
  ) {
    return this.eventsService.setMatchScore(
      id,
      user._id.toString(),
      matchNumber,
      dto,
    );
  }

  @Get(':id/standings')
  @ApiOperation({
    summary: 'Standings table, derived on read',
    description:
      'Win 3 / draw 1 / loss 0, ordered by points, goal difference, goals ' +
      'for, then name. Fixtures with no score are skipped as unplayed.',
  })
  standings(@Param('id') id: string) {
    return this.eventsService.standings(id);
  }

  // --- After-match (spec §4.4) --------------------------------------------

  @Post(':id/result')
  @ApiOperation({ summary: 'Record MVP and optional overall score' })
  @ApiResponse({ status: 400, description: 'MVP did not join, or wrong state' })
  submitResult(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: SubmitResultDto,
  ) {
    return this.eventsService.submitResult(id, user._id.toString(), dto);
  }

  @Post(':id/cover')
  @UseInterceptors(FileInterceptor('file', multerMemoryImageOptions))
  @ApiOperation({ summary: 'Set or replace the cover image' })
  setCover(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.eventsService.setCover(id, user._id.toString(), file);
  }

  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('file', multerMemoryImageOptions))
  @ApiOperation({ summary: 'Add an after-match photo (after_match only)' })
  addPhoto(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.eventsService.addPhoto(id, user._id.toString(), file);
  }

  @Delete(':id/photos/:fileId')
  @ApiOperation({ summary: 'Remove an after-match photo' })
  removePhoto(
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @CurrentUser() user: any,
  ) {
    return this.eventsService.removePhoto(id, user._id.toString(), fileId);
  }

  // --- Likes (spec §4.5) --------------------------------------------------

  @Post(':id/like')
  @ApiOperation({ summary: 'Like an event (idempotent)' })
  like(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.like(id, user._id.toString());
  }

  @Delete(':id/like')
  @ApiOperation({ summary: 'Remove a like (idempotent)' })
  unlike(@Param('id') id: string, @CurrentUser() user: any) {
    return this.eventsService.unlike(id, user._id.toString());
  }
}
